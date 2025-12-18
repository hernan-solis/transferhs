import React, { useState } from 'react';
import FileUpload from './components/FileUpload.jsx';
import TransferTable from './components/TransferTable.jsx';
import { parseExcel, normalizeData, findMatches, generateBankFile } from './utils/excelProcessing';
import { generateEcheqData, downloadEcheqFiles } from './utils/chequeProcessing';

function App() {
  const [providerData, setProviderData] = useState([]);
  const [appData, setAppData] = useState([]);
  const [matchedData, setMatchedData] = useState([]);
  const [uploadSteps, setUploadSteps] = useState({ provider: false, app: false });

  const handleProviderUpload = async (file) => {
    try {
      const data = await parseExcel(file);
      const normalized = normalizeData(data);
      console.log("Provider Data Loaded:", normalized.length, "rows");
      if (normalized.length === 0) {
        alert("El archivo de Proveedores parece no tener datos válidos o no se reconocieron las columnas (Cuit, RazSocial, CBU, etc).");
        return;
      }
      setProviderData(normalized);
      setUploadSteps(prev => ({ ...prev, provider: true }));
    } catch (error) {
      console.error("Error parsing provider file:", error);
      alert("Error al leer el archivo de proveedores");
    }
  };

  const handleAppUpload = async (file) => {
    try {
      const data = await parseExcel(file);
      const normalized = normalizeData(data);
      console.log("App Data Loaded:", normalized.length, "rows");
      if (normalized.length === 0) {
        alert("El archivo de la App parece no tener datos válidos o no se reconocieron las columnas.");
        return;
      }
      setAppData(normalized);
      setUploadSteps(prev => ({ ...prev, app: true }));
    } catch (error) {
      console.error("Error parsing app file:", error);
      alert("Error al leer el archivo de la app");
    }
  };

  const [chequeData, setChequeData] = useState([]);

  const handleChequeGeneration = () => {
    try {
      if (appData.length === 0) {
        alert("Por favor carga el archivo de Registros de App primero.");
        return;
      }
      const data = generateEcheqData(appData, providerData);
      setChequeData(data);
      alert(`Se han procesado ${data.length} registros de E-Cheqs. Revisa la tabla abajo antes de descargar.`);
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  };

  const handleDownloadCheques = () => {
    if (chequeData.length === 0) return;
    try {
      downloadEcheqFiles(chequeData);
      alert("Se han descargado los archivos Excel.");
    } catch (error) {
      console.error(error);
      alert("Error al descargar: " + error.message);
    }
  };

  const handleProcessMatches = () => {
    console.log("Processing matches...", { providerCount: providerData.length, appCount: appData.length });
    if (providerData.length === 0 || appData.length === 0) {
      console.warn("Cannot process: missing data");
      return;
    }

    const { matches, summary } = findMatches(appData, providerData);
    setMatchedData(matches);

    if (matches.length === 0) {
      let msg = "No se encontraron registros para procesar.\n\nDetalles del análisis:\n";
      msg += `- Total en archivo App: ${summary.totalRecords}\n`;
      msg += `- Ignorados por Filtro "Detalle" (no es "D.Directo DD"): ${summary.ignoredByFilter}\n`;
      msg += `- Ignorados por CUIT Especial: ${summary.ignoredBySpecialCuit}\n`;
      msg += `- Ignorados por Nombre Proveedor (Carganet, etc): ${summary.ignoredByProviderName}\n`;
      msg += `- Ignorados por Retenciones/Reembolso: ${summary.ignoredByBlacklist}\n`;
      // msg += `- Sin coincidencia CUIT: ${summary.noMatch}\n`; // These are actually included in matches array as error items

      alert(msg);
    } else {
      // Log stats for debugging
      console.log("Match Summary:", summary);
    }
  };

  const handleExport = () => {
    // We pass the currently matched (and selected handled by parent usually, but here we iterate matched)
    // Wait, TransferTable handles selection, but we need to pass the selection state up or method down
    // Actually TransferTable calls onSelectionChange, but we don't store it in parent matchedData exactly
    // Let's rely on TransferTable passing selection to a handler we store
    // Oh, wait, I need a state for selected items to export ONLY them.
  };

  const [selectedToExport, setSelectedToExport] = useState([]);

  return (
    <div className="min-h-screen bg-dark-950 p-4 md:p-8 text-white selection:bg-primary-500/30 font-sans">
      <div className="w-[95%] mx-auto space-y-12">

        {/* Header */}
        <header className="text-center space-y-4 animate-in slide-in-from-top-8 duration-700 fade-in">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-primary-200 to-primary-400 bg-clip-text text-transparent">
            Procesador de Transferencias HS
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Sube tus archivos para cruzar datos y generar el archivo de transferencias bancarias automáticamente.
          </p>
        </header>

        {/* Upload Section */}
        <div className="grid md:grid-cols-2 gap-8 animate-in slide-in-from-bottom-8 duration-700 fade-in delay-200">
          <div className="glass p-6 rounded-2xl space-y-4 transition-all duration-300 hover:bg-white/5 border border-white/5 hover:border-primary-500/30">
            <h2 className="text-xl font-semibold flex items-center gap-3">
              <span className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-colors ${uploadSteps.provider ? 'bg-green-500/20 text-green-400' : 'bg-primary-500/20 text-primary-400'}`}>
                {uploadSteps.provider ? '✓' : '1'}
              </span>
              Base de Proveedores
            </h2>
            <p className="text-sm text-gray-400">
              Excel que contiene la base de datos maestra con CUITs y CBUs.
            </p>
            <FileUpload
              label="Arrastra o selecciona el archivo"
              onFileSelect={handleProviderUpload}
            />
          </div>

          <div className="glass p-6 rounded-2xl space-y-4 transition-all duration-300 hover:bg-white/5 border border-white/5 hover:border-primary-500/30">
            <h2 className="text-xl font-semibold flex items-center gap-3">
              <span className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-colors ${uploadSteps.app ? 'bg-green-500/20 text-green-400' : 'bg-primary-500/20 text-primary-400'}`}>
                {uploadSteps.app ? '✓' : '2'}
              </span>
              Registros de App
            </h2>
            <p className="text-sm text-gray-400">
              Excel exportado de la aplicación con los montos a transferir.
            </p>
            <FileUpload
              label="Arrastra o selecciona el archivo"
              onFileSelect={handleAppUpload}
            />
          </div>
        </div>

        {/* Results Section */}
        <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-700 fade-in delay-300">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-white">Resultados de Coincidencia</h2>
            <div className="flex gap-4">
              {uploadSteps.app && (
                <button
                  onClick={handleChequeGeneration}
                  className="px-4 py-2 rounded-lg bg-pink-500 hover:bg-pink-600 text-white font-medium transition-colors shadow-lg shadow-pink-500/20 flex items-center gap-2"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <line x1="20" y1="8" x2="20" y2="14" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                  Generar E-Cheqs
                </button>
              )}
              {(uploadSteps.app && uploadSteps.provider) && (
                <button
                  onClick={handleProcessMatches}
                  className="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white font-medium transition-colors shadow-lg shadow-primary-500/20"
                >
                  Procesar Coincidencias
                </button>
              )}
            </div>
          </div>

          {matchedData.length > 0 ? (
            <TransferTable
              data={matchedData}
              onExport={() => generateBankFile(selectedToExport)}
              onSelectionChange={setSelectedToExport}
            />
          ) : (
            chequeData.length === 0 && (
              <div className="glass-card rounded-2xl p-12 flex flex-col items-center justify-center text-gray-500 border-dashed border-2 border-white/10">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <TransferTableIcon className="text-gray-600" />
                </div>
                <p className="text-lg font-medium text-gray-400">Esperando archivos para procesar...</p>
                <p className="text-sm text-gray-600 mt-2">Sube ambos archivos arriba para comenzar el cruce de datos.</p>

                {/* Dev Only: Button to fill dummy data */}
                <button
                  onClick={() => setMatchedData([
                    { id: 1, date: '2023-10-25', providerName: 'Tech Solutions SRL', cuit: '30-12345678-9', description: 'Servicios Octubre', amount: 150000.00, matchConfidence: 'exact', cbu: '000001230000' },
                    { id: 2, date: '2023-10-26', providerName: 'Librería El Estudiante', cuit: '30-87654321-0', description: 'Insumos varios', amount: 24500.50, matchConfidence: 'partial', cbu: '000004560000' },
                    { id: 3, date: '2023-10-27', providerName: 'Servicios de Limpieza SA', cuit: '33-11223344-5', description: 'Limpieza Mensual', amount: 89000.00, matchConfidence: 'exact', cbu: '000007890000' },
                  ])}
                  className="mt-8 text-xs text-primary-400/50 hover:text-primary-400 underline"
                >
                  (Dev) Cargar Datos de Prueba
                </button>
              </div>
            )
          )}
        </div>


        {chequeData.length > 0 && (
          <div className="space-y-4 animate-in slide-in-from-bottom-8 duration-700 fade-in delay-300 mt-12">
            <div className="flex items-center justify-between border-t border-white/10 pt-8">
              <h2 className="text-2xl font-semibold text-white">Resumen de E-Cheqs Generados</h2>
              <button
                onClick={handleDownloadCheques}
                className="px-4 py-2 rounded-lg bg-pink-500 hover:bg-pink-600 text-white font-medium transition-colors shadow-lg shadow-pink-500/20 flex items-center gap-2"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Descargar Archivos Excel
              </button>
            </div>

            <div className="rounded-xl border border-white/10 overflow-hidden bg-dark-900/50 backdrop-blur-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-400">
                  <thead className="bg-white/5 text-gray-200 font-medium">
                    <tr>
                      <th className="px-6 py-4">Razón Social</th>
                      <th className="px-6 py-4">CUIT</th>
                      <th className="px-6 py-4 text-right">Monto</th>
                      <th className="px-6 py-4">Nro Cheque</th>
                      <th className="px-6 py-4">Fecha Pago</th>
                      <th className="px-6 py-4">Concepto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {chequeData.map((row, i) => {
                      const isNewChunk = i > 0 && i % 25 === 0;
                      return (
                        <React.Fragment key={i}>
                          {isNewChunk && (
                            <tr className="bg-primary-500/10 border-y border-primary-500/30">
                              <td colSpan="6" className="px-6 py-2 text-xs font-semibold text-primary-300 text-center uppercase tracking-wider">
                                --- Inicio de Archivo Parte {Math.floor(i / 25) + 1} ---
                              </td>
                            </tr>
                          )}
                          <tr className="hover:bg-white/5 transition-colors">
                            <td className="px-6 py-4 text-gray-300 font-medium">{row['Razon Social']}</td>
                            <td className="px-6 py-4 font-mono">{row['Nro. de documento']}</td>
                            <td className="px-6 py-4 text-right text-emerald-400 font-medium">
                              $ {Number(row['Monto']).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4 font-mono text-primary-300">{row['Nro de cheque']}</td>
                            <td className="px-6 py-4">{row['Fecha de pago']}</td>
                            <td className="px-6 py-4 text-xs max-w-[200px] truncate" title={row['Descripcion 1']}>
                              {row['Descripcion 1']} <span className="text-gray-600">|</span> {row['Descripcion 2']}
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const TransferTableIcon = ({ className }) => (
  <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18" />
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
  </svg>
);

export default App;
