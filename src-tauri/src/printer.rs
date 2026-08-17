use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SandvikLabelPrintPayload {
    pub item_code: String,
    pub description: String,
    pub quantity: i64,
    pub weight: String,
    pub packaging_date: Option<String>,
    pub bin_location: String,
    pub qr_data: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PrinterConfig {
    pub default_label_printer: Option<String>,
    pub auto_print_on_scan: bool,
    pub auto_print_on_receive: bool,
    pub print_density_dpmm: Option<i32>, // 8 dpmm = 203 dpi, 12 dpmm = 300 dpi
}

/// Obtiene la lista de impresoras disponibles en el sistema operativo
pub fn get_available_printers() -> Result<Vec<PrinterInfo>, String> {
    let mut printers = Vec::new();

    #[cfg(target_os = "linux")]
    {
        // 1. Obtener la impresora predeterminada de CUPS
        let default_name = match Command::new("lpstat").arg("-d").output() {
            Ok(out) => {
                let s = String::from_utf8_lossy(&out.stdout);
                if let Some(pos) = s.find(':') {
                    s[pos + 1..].trim().to_string()
                } else {
                    String::new()
                }
            }
            Err(_) => String::new(),
        };

        // 2. Obtener lista con lpstat -p o lpstat -e
        let output = Command::new("lpstat")
            .arg("-e")
            .output()
            .or_else(|_| Command::new("lpstat").arg("-p").output());

        if let Ok(out) = output {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let printer_name = if trimmed.starts_with("printer ") || trimmed.starts_with("impresora ") {
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if parts.len() >= 2 {
                        parts[1].to_string()
                    } else {
                        continue;
                    }
                } else {
                    trimmed.to_string()
                };

                let is_def = !default_name.is_empty() && printer_name == default_name;
                if !printers.iter().any(|p: &PrinterInfo| p.name == printer_name) {
                    printers.push(PrinterInfo {
                        name: printer_name,
                        is_default: is_def,
                        status: "En línea".to_string(),
                    });
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let ps_cmd = "Get-CimInstance Win32_Printer | Select-Object -Property Name, Default | ConvertTo-Json";
        if let Ok(out) = Command::new("powershell")
            .args(&["-NoProfile", "-Command", ps_cmd])
            .output()
        {
            let json_str = String::from_utf8_lossy(&out.stdout);
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(arr) = val.as_array() {
                    for item in arr {
                        let name = item["Name"].as_str().unwrap_or("").trim().to_string();
                        let is_def = item["Default"].as_bool().unwrap_or(false);
                        if !name.is_empty() && !printers.iter().any(|p: &PrinterInfo| p.name == name) {
                            printers.push(PrinterInfo {
                                name,
                                is_default: is_def,
                                status: "En línea".to_string(),
                            });
                        }
                    }
                } else if let Some(obj) = val.as_object() {
                    let name = obj.get("Name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                    let is_def = obj.get("Default").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !name.is_empty() {
                        printers.push(PrinterInfo {
                            name,
                            is_default: is_def,
                            status: "En línea".to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(printers)
}

/// Genera código ZPL optimizado para la etiqueta Sandvik 70mm x 100mm (203/300 DPI)
pub fn generate_sandvik_zpl(label: &SandvikLabelPrintPayload) -> String {
    let packaging_date = label.packaging_date.clone().unwrap_or_else(|| {
        chrono::Local::now().format("%d/%m/%y").to_string()
    });
    let qr_content = label.qr_data.as_deref().unwrap_or(&label.item_code);

    format!(
        "^XA\n\
        ^PW560\n\
        ^LL800\n\
        ^PON\n\
        ^LH0,0\n\
        ^FO30,30^A0N,32,32^FDSANDVIK^FS\n\
        ^FO30,70^GB500,0,2^FS\n\
        ^FO30,85^A0N,40,40^FD{}^FS\n\
        ^FO30,135^A0N,26,26^FB500,2,0,L,0^FD{}^FS\n\
        ^FO30,205^GB500,0,2^FS\n\
        ^FO30,225^A0N,24,24^FDQuantity/pack:^FS\n\
        ^FO260,225^A0N,26,26^FD{} EA^FS\n\
        ^FO30,265^A0N,24,24^FDProduct weight:^FS\n\
        ^FO260,265^A0N,26,26^FD{} kg^FS\n\
        ^FO30,305^A0N,24,24^FDPackaging date:^FS\n\
        ^FO260,305^A0N,26,26^FD{}^FS\n\
        ^FO30,345^A0N,24,24^FDBin location:^FS\n\
        ^FO260,345^A0N,30,30^FD{}^FS\n\
        ^FO30,395^GB500,0,2^FS\n\
        ^FO30,420^BQN,2,6^FDQA,{}^FS\n\
        ^FO220,450^A0N,18,18^FB310,4,0,L,0^FDAll trademarks and logotypes appearing on this label are owned by Sandvik Group^FS\n\
        ^XZ\n",
        label.item_code.trim(),
        label.description.trim(),
        label.quantity,
        label.weight.trim(),
        packaging_date.trim(),
        label.bin_location.trim(),
        qr_content.trim()
    )
}

/// Envía contenido ZPL / RAW directamente a la impresora seleccionada en segundo plano
pub fn send_raw_to_printer(printer_name: Option<String>, raw_data: &str) -> Result<String, String> {
    let mut temp_file = std::env::temp_dir();
    let file_name = format!("label_print_{}.zpl", chrono::Local::now().timestamp_millis());
    temp_file.push(file_name);

    fs::write(&temp_file, raw_data).map_err(|e| format!("Error escribiendo archivo temporal ZPL: {}", e))?;

    let file_path_str = temp_file.to_string_lossy().to_string();

    #[cfg(target_os = "linux")]
    {
        let mut cmd = Command::new("lp");
        cmd.arg("-o").arg("raw");

        if let Some(ref p) = printer_name {
            if !p.trim().is_empty() {
                cmd.arg("-d").arg(p.trim());
            }
        }
        cmd.arg(&file_path_str);

        let output = cmd.output().map_err(|e| format!("Error ejecutando comando lp en Linux: {}", e))?;
        let _ = fs::remove_file(&temp_file);

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Fallo de impresión CUPS (lp): {}", err_msg));
        }

        let target_display = printer_name.unwrap_or_else(|| "Predeterminada".to_string());
        Ok(format!("Etiqueta enviada exitosamente a la impresora: {}", target_display))
    }

    #[cfg(target_os = "windows")]
    {
        let target_printer = printer_name.unwrap_or_default();
        let ps_cmd = if !target_printer.trim().is_empty() {
            format!(
                "Get-Content -Raw -Encoding UTF8 -Path '{}' | Out-Printer -Name '{}'",
                file_path_str.replace("'", "''"),
                target_printer.replace("'", "''")
            )
        } else {
            format!(
                "Get-Content -Raw -Encoding UTF8 -Path '{}' | Out-Printer",
                file_path_str.replace("'", "''")
            )
        };

        let output = Command::new("powershell")
            .args(&["-NoProfile", "-Command", &ps_cmd])
            .output()
            .map_err(|e| format!("Error ejecutando impresión en Windows: {}", e))?;

        let _ = fs::remove_file(&temp_file);

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Fallo de impresión en Windows: {}", err_msg));
        }

        let target_display = if !target_printer.is_empty() { target_printer } else { "Predeterminada".to_string() };
        Ok(format!("Etiqueta enviada exitosamente a la impresora: {}", target_display))
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = fs::remove_file(&temp_file);
        Err("Impresión silenciosa no soportada en este sistema operativo".to_string())
    }
}
