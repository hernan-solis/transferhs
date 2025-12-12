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
                const knownHeaders = ['cuit', 'razsocial', 'importe', 'detalle', 'cbu', 'nombre', 'haber', 'descrip', 'descrip2', 'fecval'];

                for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
                    const rowStr = JSON.stringify(rawRows[i]).toLowerCase();
                    const matchCount = knownHeaders.filter(h => rowStr.includes(h)).length;

                    if (matchCount >= 2 || (rowStr.includes('cuit') && rowStr.includes('nombre'))) {
                        headerRowIndex = i;
                        break;
                    }
                }

                // Now parse again using this header row
                let jsonData = utils.sheet_to_json(sheet, { range: headerRowIndex });

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
            else if (normalizedKey === 'orden' || normalizedKey === 'op') newRow['paymentOrder'] = row[key]; // Capture Orden de Pago
            else if (normalizedKey === 'descrip') newRow['invoiceNumber'] = row[key]; // Description (001-...) used for logic
            else if (normalizedKey === 'descrip2' || normalizedKey === 'detalle_de_orden_de_pago' || normalizedKey === 'detalle_op') newRow['paymentDetail'] = row[key]; // Column R - Detalle de Orden de Pago
            else if (normalizedKey === 'coment') newRow['paymentDetail'] = row[key]; // Column R (User confirmed 'coment' header is Col R)

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

    const summary = {
        totalRecords: appRecords.length,
        ignoredByFilter: 0,
        matched: 0,
        noMatch: 0
    };

    const matches = [];
    const unmatched = [];

    // Special CUITs list from VBA script
    const specialCuits = new Set([
        "20271370440", "20280864588", "20304161923",
        "20264164371", "20313523862", "20180310046"
    ]);

    appRecords.forEach((record, index) => {
        // 1. Filter logic: 'detalle' must be "D.Directo DD"
        // We accept variations like "Directo" or "DD" to be safe with spacing/casing
        const detalleVal = record['filterDetail'] || record['detalle'];
        const normalizedDetalle = String(detalleVal || '').toLowerCase().trim();

        if (!normalizedDetalle.includes("directo") && !normalizedDetalle.includes("dd")) {
            summary.ignoredByFilter++;
            return;
        }

        const cuit = getCuit(record);
        // Clean matching: logic uses CUIT without hyphens
        const cleanCuit = cuit ? cuit.replace(/-/g, '') : "";

        // Explicitly exclude strict blacklist CUITs (e.g. 30500001735, 30718743105)
        if (cleanCuit === '30500001735' || cleanCuit === '30718743105') {
            summary.ignoredByBlacklist = (summary.ignoredByBlacklist || 0) + 1;
            return;
        }

        // EXCLUDE 'Anticipo Choferes' (Special CUITs) for now as requested
        if (specialCuits.has(cleanCuit)) {
            summary.ignoredBySpecialCuit++;
            return;
        }

        let motivo = "Varios";

        // Logic for Payment Order (orden): Last 12 chars
        let rawOp = record['paymentOrder'] || record['orden'] || '';
        let strOp = String(rawOp).trim();
        let paymentOrder = strOp.length > 12 ? strOp.slice(-12) : strOp;

        const invoiceNumber = record['invoiceNumber'] || record['descrip'] || '';
        const paymentDetail = record['paymentDetail'] || record['descrip2'] || '';

        // Note: VBA puts Email from Agenda into 'descrip' column. 
        // We will store it in 'email' field and use it for export.

        const amount = record.amount || 0;
        const date = record.date || new Date().toLocaleDateString();

        // Find Provider Match
        // We look up by clean CUIT
        if (cleanCuit && providerMap.has(cleanCuit)) {
            const provider = providerMap.get(cleanCuit);
            const providerName = provider.nombre || provider.razon_social || provider.proveedor || 'Proveedor Encontrado';

            // Map fields from Agenda
            const cbu = provider.cbu || provider.cuenta || '';
            const email = provider['email'] || provider['email_destinatario'] || '';

            // VBA: If special char in invoice/comment, originally ignored, but Macro provided REMOVED that check. 
            // We blindly accept as the macro does, unless specific instructions say otherwise.

            matches.push({
                id: `match-${index}`,
                originalId: index,
                cuit: cleanCuit,
                providerName,
                cbu,
                paymentOrder,
                invoiceNumber, // This is 'descrip' from App file currently.
                paymentDetail, // This is 'descrip2' (Column R)
                motivo,        // New field for 'Motivo'
                email,         // Fill from Provider
                amount,
                date,
                status: 'ready',
                matchConfidence: 'exact',
                description: paymentDetail || invoiceNumber || `OP: ${paymentOrder}` // Default description to paymentDetail if available
            });
            summary.matched++;
        } else {
            // No Match Found in Agenda
            // VBA: Leaves CBU and Email empty. Does NOT delete the row.
            matches.push({
                id: `nomatch-${index}`,
                originalId: index,
                cuit: cleanCuit || 'Sin CUIT',
                providerName: 'NO ENCONTRADO EN AGENDA',
                cbu: '', // Empty as per VBA logic (clears cell)
                paymentOrder,
                invoiceNumber,
                paymentDetail, // This is 'descrip2' (Column R)
                motivo,
                email: '', // Empty
                amount,
                date,
                status: 'error', // UI will show red
                matchConfidence: 'no_match',
                error: 'Falta en Agenda',
                description: paymentDetail || invoiceNumber || `OP: ${paymentOrder}`
            });
            summary.noMatch++;
        }
    });

    return { matches, unmatched, summary };
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
        const emailField = includeEmail ? rec.email : '';

        // Header format matches user request and screenshot (6 columns)
        return {
            'CBU/CVU/Alias/Nro cuenta': rec.cbu,
            'Importe': Number(rec.amount),
            'Motivo': rec.motivo || 'Varios',
            'Descripción (opcional)': rec.invoiceNumber || rec.paymentOrder || '', // "001-..." (User calls this 'n de op') // UPDATED
            'Email destinatario (opcional)': emailField,
            'Mensaje del email (opcional)': emailField ? (rec.paymentDetail || '') : ''
        };
    });

    const ws = utils.json_to_sheet(dataToExport);

    // Adjust column widths
    const wscols = [
        { wch: 25 }, // CBU
        { wch: 15 }, // Importe
        { wch: 10 }, // Motivo
        { wch: 25 }, // Descripción
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
