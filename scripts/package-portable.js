import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const sourceExe = path.join(rootDir, 'src-tauri', 'target', 'release', 'LogixDesktop.exe');
const targetDir = path.join(rootDir, 'dist-portable', 'logix_desktop');
const targetDataDir = path.join(targetDir, 'data');
const slottingSource = path.join(rootDir, 'data', 'slotting_parameters.json');
const iconIco = path.join(rootDir, 'src-tauri', 'icons', 'icon.ico');

console.log('📦 Preparando distribución portable en: dist-portable/logix_desktop/');

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

// Copiar icono de la aplicación
if (fs.existsSync(iconIco)) {
    const targetIcon = path.join(targetDir, 'app_icon.ico');
    fs.copyFileSync(iconIco, targetIcon);
}

// Crear acceso directo (.lnk) de Windows en la carpeta portable
const shortcutPath = path.join(targetDir, 'Logix Desktop.lnk');
try {
    const psScript = `
        $WshShell = New-Object -ComObject WScript.Shell;
        $Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\')}');
        $Shortcut.TargetPath = '${targetExe.replace(/\\/g, '\\\\')}';
        $Shortcut.WorkingDirectory = '${targetDir.replace(/\\/g, '\\\\')}';
        $Shortcut.Description = 'Iniciar Logix Desktop Portable';
        $Shortcut.IconLocation = '${targetExe.replace(/\\/g, '\\\\')},0';
        $Shortcut.Save();
    `;
    execSync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, ' ')}"`, { stdio: 'ignore' });
    console.log('✅ Acceso directo creado:', shortcutPath);
} catch (e) {
    console.warn('⚠️ No se pudo crear el acceso directo .lnk automáticamente:', e.message);
}

// Crear script complementario "Crear Acceso en Escritorio.cmd" por si el usuario mueve la carpeta portable de ubicación o pendrive
const desktopScriptPath = path.join(targetDir, 'Crear_Acceso_Directo_Escritorio.cmd');
const cmdContent = `@echo off
chcp 65001 >nul
echo Creando acceso directo a Logix Desktop en su Escritorio...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -ComObject WScript.Shell; $Desktop = [Environment]::GetFolderPath('Desktop'); $Shortcut = $WshShell.CreateShortcut((Join-Path $Desktop 'Logix Desktop.lnk')); $Shortcut.TargetPath = (Join-Path $PSScriptRoot 'LogixDesktop.exe'); $Shortcut.WorkingDirectory = $PSScriptRoot; $Shortcut.Description = 'Logix Desktop Portable'; $Shortcut.IconLocation = (Join-Path $PSScriptRoot 'LogixDesktop.exe') + ',0'; $Shortcut.Save()"
echo Listo. Ya puede iniciar Logix Desktop desde el acceso directo de su Escritorio.
pause
`;
fs.writeFileSync(desktopScriptPath, cmdContent, 'utf8');
console.log('✅ Utilidad "Crear_Acceso_Directo_Escritorio.cmd" generada.');

console.log('\n🎉 ¡Estructura portable con acceso directo creada exitosamente en dist-portable/logix_desktop!');

