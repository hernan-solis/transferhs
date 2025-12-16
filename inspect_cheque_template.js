import pkg from 'xlsx';
const { readFile, utils } = pkg;

const filePath = "C:\\Users\\Hernán\\Documents\\TRONADOR APP\\CHEQUES\\PLANTILLA ECHEQS GALICIA 2025.xlsx";

try {
    console.log("Attempting to read:", filePath);
    const workbook = readFile(filePath);
    console.log("Sheet Names:", workbook.SheetNames);

    // Look for a sheet that likely contains the template data
    const targetSheetName = workbook.SheetNames.find(name => name.toLowerCase().includes('plantilla')) || workbook.SheetNames[1] || workbook.SheetNames[0];
    console.log("Inspecting Sheet:", targetSheetName);
    const sheet = workbook.Sheets[targetSheetName];

    // Get headers (first row)
    const headers = utils.sheet_to_json(sheet, { header: 1 })[0];

    // Get raw JSON to see data structure
    const jsonData = utils.sheet_to_json(sheet);

    console.log("--- EXCEL INSPECTION ---");
    console.log("Headers:", headers);
    console.log("First Row Sample:", jsonData[0]);
    console.log("------------------------");

} catch (error) {
    console.error("Error reading file:", error.message);
    console.error(error);
}
