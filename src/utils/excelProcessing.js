import { read, utils, write } from 'xlsx';

export const parseExcel = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = read(data, { type: 'array' });

                // Priority: 'AGENDA' sheet (Provider DB), otherwise first sheet
                let sheetName = workbook.SheetNames[0];
                if (workbook.SheetNames.includes('AGENDA')) {
                    sheetName = 'AGENDA';
                    console.log("Found AGENDA sheet, using it.");
                }

                const sheet = workbook.Sheets[sheetName];

                // Convert to array of arrays first to find the header row
                const rawRows = utils.sheet_to_json(sheet, { header: 1 });

                // Find header row: look for row containing known keys
                let headerRowIndex = 0;
                // Extended known headers to include App file columns like 'haber', 'descrip'
                const knownHeaders = ['cuit', 'razsocial', 'importe', 'detalle', 'cbu', 'nombre', 'haber', 'descrip', 'fecval'];

                for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
                    const rowStr = JSON.stringify(rawRows[i]).toLowerCase();
                    const matchCount = knownHeaders.filter(h => rowStr.includes(h)).length;

                    if (matchCount >= 2 || (rowStr.includes('cuit') && rowStr.includes('nombre'))) {
                        headerRowIndex = i;
                        break;
                    }
                }

                // Now parse again using this header row
                const jsonData = utils.sheet_to_json(sheet, { range: headerRowIndex });
                resolve(jsonData);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
};

/**
 * Normalizes keys to standard internal format
 */
export const normalizeData = (data) => {
    return data.map(row => {
        const newRow = {};
        Object.keys(row).forEach(key => {
            const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');

            // Map specific Spanish columns to internal keys
            if (normalizedKey === 'razsocial' || normalizedKey === 'beneficiario') newRow['providerName'] = row[key];
            else if (normalizedKey === 'haber') newRow['amount'] = row[key]; // Amount
            else if (normalizedKey === 'detalle') newRow['filterDetail'] = row[key]; // For filtering D.Directo DD
            else if (normalizedKey === 'orden' || normalizedKey === 'op') newRow['paymentOrder'] = row[key]; // Capture Orden de Pago
            else if (normalizedKey === 'descrip') newRow['invoiceNumber'] = row[key]; // Description (001-...) used for logic
            else if (normalizedKey === 'coment') newRow['emailMessage'] = row[key]; // Email Message (FAC...)

            else if (normalizedKey === 'cuit' || normalizedKey === 'cuil') newRow['cuit'] = String(row[key]).replace(/[^0-9]/g, '');
            else if (normalizedKey === 'cbu') newRow['cbu'] = row[key];
            else if (normalizedKey === 'fecha' || normalizedKey === 'fecval') newRow['date'] = row[key];
            else if (normalizedKey === 'email_destinatario' || normalizedKey === 'email') newRow['email'] = row[key];

            newRow[normalizedKey] = row[key];
        });

        // Fill defaults
        if (!newRow.providerName && newRow.nombre) newRow.providerName = newRow.nombre;
        // Fallback for amount
        if (!newRow.amount && newRow.monto) newRow.amount = newRow.monto;
        if (!newRow.amount && newRow.importe) newRow.amount = newRow.importe;

        return { ...row, ...newRow };
    });
};

/**
 * Helper to extract clean CUIT from a row
 */
const getCuit = (row) => {
    // Priority keys
    const keys = Object.keys(row);
    const cuitKey = keys.find(k =>
        ['cuit', 'cuil', 'nro_doc', 'identificacion', 'tax_id'].some(term => k.includes(term))
    );

    let val = cuitKey ? row[cuitKey] : null;

    // Fallback: look for value that looks like CUIT (11 digits) if no key match
    if (!val) {
        val = Object.values(row).find(v => {
            const str = String(v).replace(/[^0-9]/g, '');
            return str.length === 11;
        });
    }

    return val ? String(val).replace(/[^0-9]/g, '') : null;
};

export const findMatches = (appRecords, providerDb) => {
    const providerMap = new Map();

    // Index providers by CUIT (normalized)
    providerDb.forEach(row => {
        const cuit = getCuit(row);
        if (cuit) providerMap.set(cuit, row);
    });

    const matches = [];
    const unmatched = [];

    // Special CUITs list from VBA script to exclude
    const specialCuits = new Set([
        "20271370440", "20280864588", "20304161923",
        "20264164371", "20313523862", "20180310046"
    ]);

    appRecords.forEach((record, index) => {
        // 1. Filter logic: 'detalle' must be 'D.Directo DD' (mapped to filterDetail)
        const detalleVal = record['filterDetail'] || record['detalle'];
        // Strict check as per VBA, assuming the string matches exactly or close enough
        if (String(detalleVal).trim() !== "D.Directo DD") {
            return; // Skip this record
        }

        const cuit = getCuit(record);

        // EXCLUDE special CUITs (Anticipos Choferes) as requested
        if (cuit && specialCuits.has(cuit)) {
            return;
        }

        const cuitVal = String(cuit || "");

        // Attempt standard match
        if (cuit && providerMap.has(cuit)) {
            const provider = providerMap.get(cuit);

            const providerName = provider.nombre || provider.razon_social || provider.proveedor || 'Proveedor Encontrado';

            // Exclude specific providers by name as requested
            if (providerName.toLowerCase().includes("carganet")) {
                return;
            }

            const cbu = provider.cbu || provider.cuenta || '';
            const email = provider['email'] || provider['email_destinatario'] || '';

            // User's 'orden' mapped to paymentOrder
            let rawOp = record['paymentOrder'] || record['orden'] || '';
            let paymentOrder = '';
            if (rawOp) {
                const strOp = String(rawOp).trim();
                // User requested last 10 characters (e.g. 1-00078331)
                paymentOrder = strOp.length > 10 ? strOp.slice(-10) : strOp;
            }

            // User's 'descrip' mapped to invoiceNumber (used for logic)
            const invoiceNumber = record['invoiceNumber'] || record['descrip'] || '';
            // User's 'coment' mapped to emailMessage
            const emailMessage = record['emailMessage'] || record['coment'] || '';

            // Fallback description for display if needed
            const displayDesc = paymentOrder ? `OP: ${paymentOrder}` : (invoiceNumber || 'Varios');

            // Exclude records that look like Retentions
            if (String(invoiceNumber).toLowerCase().includes("retenci") || String(emailMessage).toLowerCase().includes("retenci")) {
                return;
            }

            const date = record.date || new Date().toLocaleDateString();

            let matchConfidence = 'exact';
            let error = null;

            if (!cbu) {
                matchConfidence = 'warning';
                error = 'Falta CBU en la base de proveedores';
            }

            matches.push({
                id: `match-${index}`,
                originalId: index,
                cuit,
                providerName,
                cbu,
                paymentOrder,
                invoiceNumber,
                emailMessage,
                email,
                amount,
                date,
                status: 'ready',
                matchConfidence,
                error,
                description: displayDesc, // For UI display
            });
        }
        // We can handle unmatched logic if needed
    });

    return { matches, unmatched };
};

export const generateBankFile = (selectedRecords) => {
    // Whitelist for emails
    const emailWhitelist = ["trinidad", "stefanazzi", "vialidad"];

    // Check if provider name contains any whitelist keyword
    const shouldIncludeEmail = (name) => {
        if (!name) return false;
        const lowerName = name.toLowerCase();
        return emailWhitelist.some(keyword => lowerName.includes(keyword));
    };

    // Map to specific requested columns
    const dataToExport = selectedRecords.map(rec => {
        const includeEmail = shouldIncludeEmail(rec.providerName);

        // Header format matches user request
        return {
            'CBU/CVU/Alias/Nro cuenta': rec.cbu,
            'Importe': Number(rec.amount), // Ensure number for Excel
            'Motivo': 'Varios',
            'Descripción (opcional)': rec.paymentOrder || '', // Strictly OP now
            'Email destinatario (opcional)': includeEmail ? rec.email : '',
            'Mensaje del email (opcional)': (includeEmail && rec.invoiceNumber && rec.emailMessage) ? rec.emailMessage : ''
        };
    });

    const ws = utils.json_to_sheet(dataToExport);

    // Adjust column widths for better UX in the output file
    const wscols = [
        { wch: 25 }, // CBU
        { wch: 15 }, // Importe
        { wch: 10 }, // Motivo
        { wch: 20 }, // Descripción
        { wch: 30 }, // Email
        { wch: 30 }  // Mensaje
    ];
    ws['!cols'] = wscols;

    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Formulario"); // Sheet name 'Formulario' matches VBA

    // Generate download
    const wbout = write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });

    // Trigger download
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transferencias_banco_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
};
