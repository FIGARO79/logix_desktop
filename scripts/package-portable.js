import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const sourceExe = path.join(rootDir, 'src-tauri', 'target', 'release', 'LogixDesktop.exe');
const targetDir = path.join(rootDir, 'dist-portable', 'logix_desktop');
const targetDataDir = path.join(targetDir, 'data');
const slottingSource = path.join(rootDir, 'data', 'slotting_parameters.json');

console.log('📦 Preparando distribución portable en: logix_desktop/');

if (!fs.existsSync(sourceExe)) {
    console.error('❌ No se encontró el ejecutable compilado en:', sourceExe);
    console.error('👉 Ejecuta primero: npm run tauri:build');
    process.exit(1);
}

// Crear directorios de destino
fs.mkdirSync(targetDataDir, { recursive: true });

// Copiar ejecutable
const targetExe = path.join(targetDir, 'LogixDesktop.exe');
fs.copyFileSync(sourceExe, targetExe);
console.log('✅ Ejecutable copiado:', targetExe);

// Copiar parámetros de slotting iniciales si existen
if (fs.existsSync(slottingSource)) {
    const targetSlotting = path.join(targetDataDir, 'slotting_parameters.json');
    fs.copyFileSync(slottingSource, targetSlotting);
    console.log('✅ Parámetros iniciales copiados a data/:', targetSlotting);
}

console.log('\n🎉 ¡Estructura portable creada exitosamente en dist-portable/logix_desktop!');
