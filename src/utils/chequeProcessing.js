
import { utils, writeFile } from 'xlsx';

/**
 * Extracts the E-Check number from the "detalle" column.
 * Logic: Look for "EC GAL -" and take the number immediately following it.
 * @param {string} detalle
 * @returns {string} The extracted number or empty string.
 */
const extractCheckNumber = (detalle) => {
    if (!detalle) return '';
    const text = String(detalle).toUpperCase();
    const marker = "EC GAL -";
    const index = text.indexOf(marker);
    if (index === -1) return '';

    const remainder = text.substring(index + marker.length).trim();
    let numStr = '';
    for (let i = 0; i < remainder.length; i++) {
        const char = remainder[i];
        if (/[0-9]/.test(char)) {
            numStr += char;
        } else {
            break;
        }
    }
    return numStr;
};

/**
 * Transforms an Excel serial date to "dd/mm/yyyy" string.
 * This function accounts for the Excel epoch (December 30, 1899).
 * @param {number|string} serial
 * @returns {string}
 */
const excelDateToDDMMYYYY = (serial) => {
    if (!serial) return '';
    const num = Number(serial);
    if (isNaN(num)) {
        // Fallback: if it's already a string or date-like, try to keep it or format it
        return String(serial);
    }

    // Excel base date logic
    const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
    const date = new Date(excelEpoch.getTime() + num * 24 * 60 * 60 * 1000);

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
};

/**
 * Filters and transforms App Registry data for E-Cheq generation.
 * @param {Array} appData - Raw JSON data from the "Registros de App" Excel.
 * @param {Array} providerData - (Optional) Provider DB to look up names.
 * @returns {Array} Transformed data ready for display and download.
 */
export const generateEcheqData = (appData, providerData = []) => {
    // 1. Filter rows where 'detalle' matches "E-CHEQ" (case-insensitive)
    const filtered = appData.filter(row => {
        // Using "detalle" key. Adjust if the internal key is different (e.g., lowercase)
        const detalle = row['detalle'] || row['Detalle'] || '';
        if (!detalle) return false;
        return String(detalle).toUpperCase().includes('E-CHEQ');
    });

    if (filtered.length === 0) {
        throw new Error('No se encontraron registros de "E-CHEQ" en el archivo de la App.');
    }

    // 2. Transform into Template Object
    const transformed = filtered.map(row => {
        // Helpers to safely get values
        const getVal = (key) => row[key] || '';

        // Extract check number
        const checkNum = extractCheckNumber(getVal('detalle') || getVal('Detalle'));

        // Truncate description 1
        let desc1 = String(getVal('coment') || '');
        if (desc1.length > 14) {
            desc1 = desc1.substring(0, 14);
        }

        // Clean CUIT
        let cuit = String(getVal('cuit') || getVal('Cuit') || '');
        cuit = cuit.replace(/-/g, '');

        // Lookup Provider Name
        // 1. Try to find in the row itself (if App file has name)
        let rsocial = row['providerName'] || row['nombre'] || row['razon_social'] || 'No encontrado';

        // 2. If providerData (Agenda) is present, try to cross-reference (might be more accurate/complete)
        if (providerData.length > 0) {
            const match = providerData.find(p => {
                const pCuit = String(p.cuit || '').replace(/[^0-9]/g, '');
                return pCuit === cuit;
            });
            if (match) {
                rsocial = match.providerName || match.razon_social || match.nombre || rsocial;
            }
        }

        // Safely parse amount as Number
        let rawAmount = getVal('haber') || getVal('Haber') || 0;
        let numAmount = Number(rawAmount);

        if (isNaN(numAmount) || typeof rawAmount === 'string') {
            // Handle string formats, particularly Argentine (e.g., "1.234,50" or "$ 1234,50")
            let strAmount = String(rawAmount).trim();
            if (strAmount.includes(',')) {
                // Remove periods (thousands separators if any)
                strAmount = strAmount.replace(/\./g, '');
                // Replace comma with dot for decimals
                strAmount = strAmount.replace(',', '.');
            }
            // Strip out any remaining non-numeric characters (like $ signs) 
            // but keep the decimal point
            numAmount = Number(strAmount.replace(/[^0-9.-]+/g, ""));
        }

        return {
            'Tipo de documento': 'CUIT',
            'Nro. de documento': cuit,
            'Razon Social': rsocial, // Added for display purposes
            'Monto': numAmount || 0,
            'Fecha de pago': excelDateToDDMMYYYY(getVal('fcheqpro') || getVal('Fcheqpro')),
            'Motivo de pago': 'FACTURA',
            'Descripcion 1': desc1,
            'Descripcion 2': 'FLETE',
            'Mail': '', // Intentionally empty as per user logic
            'Clausula': 'A la orden',
            'Nro de cheque': checkNum
        };
    });

    return transformed;
};

/**
 * Downloads the E-Cheq data as Excel files split by chunks.
 * @param {Array} data - The transformed E-Cheq data.
 */
export const downloadEcheqFiles = (data) => {
    // Generate Sheets in Chunks of 25
    const CHUNK_SIZE = 25;
    const totalChunks = Math.ceil(data.length / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = start + CHUNK_SIZE;
        const chunk = data.slice(start, end);

        // Remove the internal 'Razon Social' key for the Excel file
        const cleanChunk = chunk.map(({ 'Razon Social': _, ...rest }) => rest);

        const ws = utils.json_to_sheet(cleanChunk);

        // FIX: Force explicit types to avoid bank parsing issues (e.g. need to "entrar y salir" en Excel)
        Object.keys(ws).forEach(key => {
            if (key.startsWith('!')) return;
            const cell = ws[key];

            // Column B: CUIT -> Force text so it doesn't lose precision or formatting
            if (key.startsWith('B') && key !== 'B1') {
                cell.t = 's';
                if (cell.v !== undefined && cell.v !== null) {
                    cell.v = String(cell.v);
                }
            }

            // Column C: Monto -> Force explicit number format (0.00)
            if (key.startsWith('C') && key !== 'C1') {
                cell.t = 'n';
                cell.z = '0.00';
                if (isNaN(cell.v) || isNaN(Number(cell.v))) {
                    cell.v = 0;
                } else {
                    cell.v = Number(cell.v);
                }
            }
        });

        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, "Plantilla para emision");

        const fileName = totalChunks > 1
            ? `ECHEQS_GALICIA_PARTE_${i + 1}.xlsx`
            : "ECHEQS_GALICIA_GENERADO.xlsx";

        // Download with small delay to prevent browser blocking multiple downloads
        setTimeout(() => {
            writeFile(wb, fileName, { bookType: 'xlsx', type: 'binary' });
        }, i * 500);
    }
};
