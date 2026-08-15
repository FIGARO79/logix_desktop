/**
 * Barcode & QR Code Parser Utility for WMS
 * Parses GS1-128, GS1 DataMatrix, GS1 Digital Link URLs, Delimited QRs (CSV/Pipe/Semicolon/Tab/ASCII 29),
 * Key-Value QRs (SKU:xxx, LOT:yyy), and JSON QRs.
 */

export const parseGS1Barcode = (rawInput) => {
    if (!rawInput || typeof rawInput !== 'string') {
        return { isGS1: false, isMultiField: false, itemCode: null, raw: rawInput };
    }

    let input = rawInput.trim();

    // Eliminar Symbology Identifier (AIM Flag) de escáneres móviles (ej: "]Q3", "]Q", "]d1", "]C1", "]e0")
    if (input.startsWith(']')) {
        input = input.replace(/^\][A-Za-z0-9]{1,3}/, '');
    }

    let result = {
        isGS1: false,
        isMultiField: false,
        gtin: null,
        itemCode: null,
        lotNumber: null,
        expirationDate: null,
        serialNumber: null,
        quantity: null,
        raw: input
    };

    // 1. Caso: JSON QR (ej: {"sku": "ITEM123", "lot": "LOTE99", "qty": 10})
    if (input.startsWith('{') && input.endsWith('}')) {
        try {
            const parsed = JSON.parse(input);
            result.isMultiField = true;
            result.itemCode = parsed.sku || parsed.item_code || parsed.item || parsed.part_number || parsed.pn || null;
            result.lotNumber = parsed.lot || parsed.batch || parsed.lote || null;
            result.quantity = parsed.qty || parsed.quantity || parsed.cantidad || null;
            result.expirationDate = parsed.exp || parsed.expiration_date || parsed.vencimiento || null;
            if (result.itemCode) return result;
        } catch (e) {
            // Ignorar error de parseo JSON y continuar
        }
    }

    // 2. Caso: GS1 Digital Link URL (ej: https://id.gs1.org/01/07701234567890/10/LOTE123)
    if (input.startsWith('http://') || input.startsWith('https://')) {
        result.isMultiField = true;
        try {
            const url = new URL(input);
            const pathParts = url.pathname.split('/').filter(Boolean);
            for (let i = 0; i < pathParts.length; i += 2) {
                const ai = pathParts[i];
                const val = pathParts[i + 1];
                if (!val) break;
                if (ai === '01') {
                    result.gtin = val;
                    result.itemCode = val.replace(/^0+/, '');
                    result.isGS1 = true;
                } else if (ai === '10') {
                    result.lotNumber = val;
                } else if (ai === '17') {
                    result.expirationDate = val;
                }
            }
            if (result.itemCode) return result;
        } catch (e) {
            // Ignorar error de URL
        }
    }

    // 3. Caso: Formato GS1 con paréntesis (ej: (01)07701234567890(10)LOTE123(17)261231)
    const parenRegex = /\((01|10|17|21|30)\)([^\(\)]+)/g;
    let match;
    let foundParen = false;
    while ((match = parenRegex.exec(input)) !== null) {
        foundParen = true;
        const ai = match[1];
        const val = match[2].trim();

        if (ai === '01') {
            result.gtin = val;
            result.itemCode = val.replace(/^0+/, '');
        } else if (ai === '10') {
            result.lotNumber = val;
        } else if (ai === '17') {
            if (val.length === 6) {
                const yy = val.substring(0, 2);
                const mm = val.substring(2, 4);
                const dd = val.substring(4, 6);
                result.expirationDate = `20${yy}-${mm}-${dd}`;
            } else {
                result.expirationDate = val;
            }
        } else if (ai === '21') {
            result.serialNumber = val;
        } else if (ai === '30') {
            result.quantity = parseInt(val, 10) || null;
        }
    }

    if (foundParen) {
        result.isGS1 = true;
        result.isMultiField = true;
        return result;
    }

    // 4. Caso: Separador de Grupo ASCII 29 (GS / \x1D) o barras horizontales / comas / punto y coma / tabs
    const gsClean = input.replace(/\x1D/g, '|');
    if (gsClean.includes('|') || gsClean.includes(';') || gsClean.includes('\t') || gsClean.includes('\n')) {
        const delimiter = gsClean.includes('|') ? '|' : (gsClean.includes(';') ? ';' : (gsClean.includes('\t') ? '\t' : '\n'));
        const parts = gsClean.split(delimiter).map(p => p.trim()).filter(Boolean);

        if (parts.length > 1) {
            result.isMultiField = true;

            // Intentar detectar pares Clave:Valor (ej: SKU:ITEM123 | LOT:LOTE99)
            for (const part of parts) {
                const kvMatch = part.match(/^(SKU|ITEM|PN|P\/N|LOT|LOTE|BATCH|QTY|CANT|EXP):\s*(.+)$/i);
                if (kvMatch) {
                    const key = kvMatch[1].toUpperCase();
                    const val = kvMatch[2].trim();
                    if (['SKU', 'ITEM', 'PN', 'P/N'].includes(key)) {
                        result.itemCode = val;
                    } else if (['LOT', 'LOTE', 'BATCH'].includes(key)) {
                        result.lotNumber = val;
                    } else if (['QTY', 'CANT'].includes(key)) {
                        result.quantity = parseInt(val, 10) || null;
                    } else if (key === 'EXP') {
                        result.expirationDate = val;
                    }
                }
            }

            if (result.itemCode) return result;

            // Si no eran clave-valor, tomar el primer segmento como ítem/SKU y el segundo como lote si aplica
            result.itemCode = parts[0].replace(/^0+/, '');
            if (parts[1]) result.lotNumber = parts[1];
            if (parts[2] && !isNaN(parseInt(parts[2], 10))) result.quantity = parseInt(parts[2], 10);
            return result;
        }
    }

    // 5. Caso: QR delimitado por '#' con prefijo de proveedor/planta (+Q...) e identificadores GS1 (#10..., #21, #422...)
    if (input.includes('#')) {
        const parts = input.split('#').map(p => p.trim()).filter(Boolean);
        if (parts.length > 0) {
            result.isMultiField = true;
            result.isGS1 = true;
            let seg0 = parts[0];

            // Extraer el código de ítem / SKU eliminando los primeros 6 caracteres (incluyendo el '+', ej: "+Q3240")
            if (seg0.startsWith('+')) {
                result.itemCode = seg0.length > 6 ? seg0.substring(6) : seg0.substring(1);
            } else {
                result.itemCode = seg0.replace(/^0+/, '');
            }

            // Procesar segmentos adicionales delimitados por '#'
            for (let i = 1; i < parts.length; i++) {
                const part = parts[i];
                // GS1 AI 10: Lote / Batch
                if (part.startsWith('10') && part.length > 2) {
                    result.lotNumber = part.substring(2);
                }
                // GS1 AI 21: Número de Serie
                else if (part.startsWith('21')) {
                    result.serialNumber = part.length > 2 ? part.substring(2) : part;
                }
                // GS1 AI 422: País de Origen (ISO 3166 alpha-2: CN, IT, US, etc.)
                else if (part.startsWith('422')) {
                    result.countryOfOrigin = part.substring(3);
                }
                // Fallback para lote si no se ha capturado
                else if (!result.lotNumber) {
                    result.lotNumber = part;
                }
            }

            if (result.itemCode) return result;
        }
    }

    // 6. Fallback: GS1 crudo sin paréntesis que empieza con 01 (14 dígitos GTIN)
    if (input.length >= 16 && input.startsWith('01')) {
        result.isGS1 = true;
        result.isMultiField = true;
        result.gtin = input.substring(2, 16);
        result.itemCode = result.gtin.replace(/^0+/, '');

        const remainder = input.substring(16);
        if (remainder.startsWith('10')) {
            const lotPart = remainder.substring(2);
            const expIdx = lotPart.indexOf('17');
            if (expIdx !== -1) {
                result.lotNumber = lotPart.substring(0, expIdx);
                const expVal = lotPart.substring(expIdx + 2, expIdx + 8);
                if (expVal.length === 6) {
                    result.expirationDate = `20${expVal.substring(0,2)}-${expVal.substring(2,4)}-${expVal.substring(4,6)}`;
                }
            } else {
                result.lotNumber = lotPart;
            }
        }
    }

    return result;
};
