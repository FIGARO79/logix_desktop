import React from 'react';
import { sandvikLogoBase64 } from '../../assets/logo';

const SandvikLabel = ({ data, qrImage, quantity, relocatedBin, totalWeight }) => {
    return (
        <div className="label-container" style={{
            width: '70mm',
            height: '100mm',
            padding: '3.5mm',
            boxSizing: 'border-box',
            background: 'white',
            fontFamily: 'Arial, sans-serif',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            color: '#000'
        }}>
            {/* Logo */}
            <img src={sandvikLogoBase64} alt="Sandvik" style={{ height: '7mm', display: 'block', marginBottom: '3.5mm', flexShrink: 0, alignSelf: 'flex-start' }} />

            {/* Header */}
            <div style={{ fontSize: '12pt', fontWeight: 'bold', lineHeight: 1.2, wordBreak: 'break-word' }}>{data?.itemCode || 'ITEM CODE'}</div>
            <div style={{ fontSize: '12pt', fontWeight: 'bold', lineHeight: 1.1, wordBreak: 'break-word', marginBottom: '2mm' }}>{data?.description || 'Description'}</div>

            <div style={{ flexGrow: 1 }}></div>

            {/* Data Table */}
            <div style={{ fontSize: '10pt', fontWeight: 'semibold', lineHeight: 1.4, flexShrink: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '28mm 1fr' }}>
                    <div>Quantity/pack</div>
                    <div>{quantity || 1} EA</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '28mm 1fr' }}>
                    <div>Product weight</div>
                    <div>{totalWeight} kg</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '28mm 1fr' }}>
                    <div>Packaging date</div>
                    <div>{new Date().toLocaleDateString('es-CO', { year: '2-digit', month: '2-digit', day: '2-digit' })}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '28mm 1fr' }}>
                    <div>Bin location</div>
                    <div>{relocatedBin || data?.binLocation || ''}</div>
                </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '2mm', flexShrink: 0, flexGrow: 1 }}>
                <p style={{ fontSize: '7pt', margin: 0, maxWidth: '35mm', lineHeight: 1.1 }}>
                    All trademarks and logotypes appearing on this label are owned by Sandvik Group
                </p>
                <div style={{
                    width: '25mm',
                    height: '25mm',
                    flexShrink: 0,
                    border: qrImage ? 'none' : '1px solid #e5e7eb',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box'
                }}>
                    {qrImage ? (
                        <img src={qrImage} alt="QR" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                        <div style={{ width: '100%', height: '100%' }}></div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SandvikLabel;
