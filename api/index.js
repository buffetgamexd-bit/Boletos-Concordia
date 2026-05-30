require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
const { google } = require('googleapis');
const fs = require('fs');

// ============ GOOGLE SHEETS ============
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '131iQlWoFgxbIbuyJ7JxflCBAZnuef43EDSQdWd_9s6Y';
const SHEET_TAB = 'BoletosNetworking';

async function getSheetsClient() {
  // Intentar cargar desde cualquier archivo JSON de credenciales local en el directorio padre
  try {
    const parentDir = path.join(__dirname, '..');
    const files = fs.readdirSync(parentDir);
    const credentialFile = files.find(f => f.startsWith('boletos-concordia-') && f.endsWith('.json'));
    if (credentialFile) {
      const jsonPath = path.join(parentDir, credentialFile);
      const credentials = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (credentials.client_email && credentials.private_key) {
        const auth = new google.auth.JWT({
          email: credentials.client_email,
          key: credentials.private_key,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        return google.sheets({ version: 'v4', auth });
      }
    }
  } catch (e) {
    console.warn('Advertencia al cargar archivo de credenciales local:', e.message);
  }

  // Fallback a las variables de entorno (.env)
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/"/g, ''),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureSheetTab(sheets, spreadsheetId, title, headers) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some(s => s.properties.title === title);
    if (!exists) {
      // Crear pestaña
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] }
      });
      // Escribir encabezados
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${title}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] }
      });
    }
  } catch (e) { 
    console.error(`Error al asegurar pestaña ${title}:`, e.message); 
    throw e; 
  }
}

async function appendBoletoToSheet(data) {
  if (!SHEET_ID || !process.env.GOOGLE_SERVICE_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.log('Google Sheets no configurado en .env, saltando registro');
    return;
  }
  try {
    const sheets = await getSheetsClient();
    await ensureSheetTab(sheets, SHEET_ID, SHEET_TAB, [
      'Folio', 
      'Fecha', 
      'Cliente', 
      'Email', 
      'Negocio', 
      'Giro', 
      'Teléfono', 
      'Cant. Boletos', 
      'Total MXN',
      'Estado',
      'Fecha Validación'
    ]);
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:K`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          data.folio, 
          fecha, 
          data.nombreCompleto, 
          data.email, 
          data.negocio, 
          data.giro, 
          data.telefono, 
          data.cantidad, 
          data.total,
          'Válido',
          ''
        ]],
      },
    });
    console.log(`✅ Registro exitoso en Sheets para Folio #${data.folio}`);
  } catch (err) {
    console.error('Error Google Sheets:', err.message);
  }
}

// ============ INICIALIZAR EXPRESS ============
const app = express();
app.use(cors());
app.use(express.json());

// Servir frontend
app.use(express.static(path.join(__dirname, '..')));

// Transporter SMTP para envío de correos
function getTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });
}

// ============ ENDPOINTS DE STRIPE Y BOLETOS ============

// Configuración inicial para obtener llave pública
app.get('/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

// Crear sesión de pago en Stripe
app.post('/create-checkout-session', async (req, res) => {
  const { nombre, apellidos, negocio, giro, telefono, email, qty } = req.body;
  
  if (!nombre || !apellidos || !negocio || !giro || !telefono || !email) {
    return res.status(400).json({ error: 'Todos los campos del registro son requeridos.' });
  }
  
  const quantity = parseInt(qty) || 1;
  const host = req.headers.host;
  const origin = host.includes('localhost') ? `http://${host}` : `https://${host}`;

  try {
    let line_items = [];
    const pairs = Math.floor(quantity / 2);
    const singles = quantity % 2;
    
    if (pairs > 0) {
      line_items.push({
        price_data: {
          currency: 'mxn',
          product_data: {
            name: 'Promo 2x1500 - Boletos Acceso',
            description: 'Promoción 2x1500: Experiencia exclusiva de networking.',
          },
          unit_amount: 150000,
        },
        quantity: pairs,
      });
    }
    if (singles > 0) {
      line_items.push({
        price_data: {
          currency: 'mxn',
          product_data: {
            name: 'Boleto Acceso Individual - Conexión y Negocios',
            description: 'Experiencia exclusiva de networking.',
          },
          unit_amount: 130000,
        },
        quantity: singles,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: line_items,
      mode: 'payment',
      customer_email: email,
      // Guardar todos los campos del registro en los metadatos para recuperarlos en la confirmación
      metadata: {
        nombreCompleto: `${nombre} ${apellidos}`,
        negocio: negocio,
        giro: giro,
        telefono: telefono,
        email: email,
        cantidad: quantity.toString()
      },
      success_url: `${origin}/?pago=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?pago=cancelado`,
      locale: 'es-419'
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error al crear sesión Stripe:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Obtener detalles de una sesión de Stripe
app.get('/session-details', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'session_id requerido' });
  
  try {
    const session = await stripe.checkout.sessions.retrieve(id);
    res.json({
      folio: id.slice(-8).toUpperCase(),
      nombreCompleto: session.metadata.nombreCompleto || 'Comprador',
      negocio: session.metadata.negocio || 'N/A',
      giro: session.metadata.giro || 'N/A',
      telefono: session.metadata.telefono || 'N/A',
      email: session.metadata.email || session.customer_details?.email || '',
      cantidad: parseInt(session.metadata.cantidad) || 1,
      total: session.amount_total / 100,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enviar correos de confirmación y registrar en Hojas de Cálculo
app.post('/send-confirmacion', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id requerido' });
  
  const transporter = getTransporter();
  
  try {
    // Recuperar la sesión completa
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const metadata = session.metadata;
    const folio = session_id.slice(-8).toUpperCase();
    const total = session.amount_total / 100;
    
    const clienteNombre = metadata.nombreCompleto || 'Invitado de Honor';
    const clienteEmail = metadata.email || session.customer_details?.email;
    const clienteNegocio = metadata.negocio || 'N/A';
    const clienteGiro = metadata.giro || 'N/A';
    const clienteTelefono = metadata.telefono || 'N/A';
    const cantidad = parseInt(metadata.cantidad) || 1;

    // 1. REGISTRAR EN GOOGLE SHEETS
    await appendBoletoToSheet({
      folio,
      nombreCompleto: clienteNombre,
      email: clienteEmail,
      negocio: clienteNegocio,
      giro: clienteGiro,
      telefono: clienteTelefono,
      cantidad,
      total
    });

    if (!transporter) {
      console.log('Nodemailer SMTP no configurado, saltando envíos de correo');
      return res.json({ ok: true, sheets: true, emailSent: false });
    }

    // Resolución dinámica de origen para el enlace de validación del QR
    const host = req.headers.host || 'localhost:4000';
    const origin = host.includes('localhost') ? `http://${host}` : `https://${host}`;
    const validationUrl = `${origin}/validar?folio=${folio}`;

    // Código QR dinámico para acceso rápido usando la API de QR Server
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(validationUrl)}`;

    // 2. ENVIAR CORREO AL COMPRADOR (Estilo Boarding Pass)
    if (clienteEmail) {
      const emailCompradorHtml = `
      <div style="font-family: 'Outfit', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0a0b0e; color: #f3f4f6; border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
        
        <!-- Encabezado -->
        <div style="background: linear-gradient(135deg, #181a22 0%, #111319 100%); padding: 30px; text-align: center; border-bottom: 2px dashed rgba(212, 175, 55, 0.3); position: relative;">
          <img src="cid:concordialogo" alt="Concordia Producciones" style="max-height: 70px; margin-bottom: 12px; display: inline-block;" />
          <h2 style="color: #d4af37; margin: 0; font-size: 24px; font-family: 'Playfair Display', Georgia, serif; letter-spacing: 2px; text-transform: uppercase;">CONCORDIA PRODUCCIONES</h2>
          <p style="color: #9ca3af; margin: 5px 0 0 0; font-size: 11px; letter-spacing: 4px; text-transform: uppercase;">BOARDING PASS • ACCESO AL EVENTO</p>
        </div>

        <!-- Cuerpo del Pase -->
        <div style="padding: 30px;">
          <h1 style="color: #ffffff; font-size: 22px; margin-top: 0; margin-bottom: 10px; font-weight: 600; text-align: center;">¡Tu pase de acceso está confirmado! 🎉</h1>
          <p style="color: #9ca3af; font-size: 14px; line-height: 1.6; text-align: center; margin-bottom: 30px;">
            Hola <strong>${clienteNombre}</strong>, gracias por tu interés en nuestro evento exclusivo de networking. Hemos registrado tu inscripción y tu pago de <strong>$${total.toLocaleString('es-MX')} MXN</strong> con éxito. A continuación te presentamos tu boleto digital oficial para acceder al evento.
          </p>

          <!-- Detalles del Evento -->
          <div style="background-color: rgba(212, 175, 55, 0.03); border-left: 3px solid #d4af37; border-radius: 10px; padding: 15px 20px; margin-bottom: 25px; border-top: 1px solid rgba(212,175,55,0.1); border-right: 1px solid rgba(212,175,55,0.1); border-bottom: 1px solid rgba(212,175,55,0.1);">
            <p style="margin: 0 0 10px 0; color: #ffffff; font-size: 15px; font-weight: bold;">Una experiencia de alto valor te espera:</p>
            <p style="margin: 5px 0; font-size: 14px; color: #f3f4f6;">🍸 <strong>Coctelería Premium</strong> de bienvenida</p>
            <p style="margin: 5px 0; font-size: 14px; color: #f3f4f6;">🍽️ <strong>Cena de 3 tiempos</strong> exclusiva</p>
            <p style="margin: 5px 0; font-size: 14px; color: #f3f4f6;">🤝 <strong>Networking de alto valor</strong> y conexiones reales</p>
            <p style="margin: 12px 0 0 0; font-size: 13.5px; color: #f3e5ab; line-height: 1.5;">
              💻 <strong>¡Presenta tu marca!</strong> Como asistente, tienes la oportunidad de presentar tu empresa, proyecto o servicios mediante una slide en pantalla gigante durante el evento para generar nuevas conexiones y oportunidades de negocio con compradores y vendedores.
            </p>
            <p style="margin: 8px 0 0 0; font-size: 12px; color: #9ca3af; line-height: 1.4;">
              <em>Para coordinar la proyección, envía tu slide de presentación (formato 16:9 / horizontal) respondiendo directamente a este correo electrónico.</em>
            </p>
          </div>

          <!-- Tarjeta de Boleto Estilo Físico -->
          <div style="background-color: #12141a; border: 1px solid rgba(212, 175, 55, 0.2); border-radius: 15px; padding: 25px; margin-bottom: 25px;">
            
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; margin-bottom: 15px;">
              <div>
                <span style="font-size: 10px; color: #9ca3af; text-transform: uppercase; display: block; letter-spacing: 1px;">EVENTO</span>
                <strong style="font-size: 15px; color: #f3e5ab;">CONEXIÓN Y NEGOCIOS</strong>
              </div>
              <div style="text-align: right;">
                <span style="font-size: 10px; color: #9ca3af; text-transform: uppercase; display: block; letter-spacing: 1px;">FOLIO BOLETO</span>
                <strong style="font-size: 15px; color: #d4af37;">#${folio}</strong>
              </div>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
              <tr>
                <td style="padding: 6px 0; font-size: 13px; color: #9ca3af;">Asistente:</td>
                <td style="padding: 6px 0; font-size: 13px; color: #ffffff; text-align: right; font-weight: bold;">${clienteNombre}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-size: 13px; color: #9ca3af;">Negocio / Marca:</td>
                <td style="padding: 6px 0; font-size: 13px; color: #ffffff; text-align: right;">${clienteNegocio}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-size: 13px; color: #9ca3af;">Giro:</td>
                <td style="padding: 6px 0; font-size: 13px; color: #ffffff; text-align: right;">${clienteGiro}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-size: 13px; color: #9ca3af;">Boletos Adquiridos:</td>
                <td style="padding: 6px 0; font-size: 13px; color: #d4af37; text-align: right; font-weight: bold;">${cantidad} ${cantidad === 1 ? 'Acceso' : 'Accesos'}</td>
              </tr>
            </table>

            <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 15px; display: flex; align-items: center; justify-content: space-between;">
              <div>
                <span style="font-size: 10px; color: #9ca3af; text-transform: uppercase; display: block;">FECHA Y HORA</span>
                <strong style="font-size: 13px; color: #ffffff;">3 Jun 2026 | 7:00 PM</strong>
              </div>
              <div style="text-align: right;">
                <span style="font-size: 10px; color: #9ca3af; text-transform: uppercase; display: block;">LUGAR</span>
                <strong style="font-size: 13px; color: #ffffff;">Club Altozano, Qro.</strong>
              </div>
            </div>

            <!-- Código QR de Acceso Integrado -->
            <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px; margin-top: 20px; text-align: center;">
              <span style="font-size: 10px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 12px; letter-spacing: 2px;">
                ${cantidad === 1 ? 'CÓDIGO QR DE ACCESO PERSONAL' : `CÓDIGO QR DE ACCESO GRUPAL (${cantidad} PERSONAS)`}
              </span>
              <div style="background-color: #ffffff; padding: 12px; display: inline-block; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
                <img src="${qrUrl}" alt="Código QR de Validación" style="width: 150px; height: 150px; display: block;" />
              </div>
              <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0; line-height: 1.4;">
                Presenta este código QR en tu celular para ingresar al evento (Válido para ${cantidad} ${cantidad === 1 ? 'persona' : 'personas'}).<br />
                <em style="color: #d4af37;">Una vez escaneado por el staff, quedará inhabilitado.</em>
              </p>
            </div>

          </div>

          <!-- Nota informativa de ubicación -->
          <div style="background-color: rgba(212, 175, 55, 0.05); border: 1px solid rgba(212, 175, 55, 0.1); border-radius: 10px; padding: 15px; font-size: 12px; line-height: 1.5; color: #f3e5ab; text-align: center;">
            📍 <strong>Ubicación del evento:</strong> Club Altozano Querétaro. Te sugerimos llegar 15 minutos antes para el registro y coctelería de bienvenida. ¡Prepara tus tarjetas de presentación digitales o físicas!
          </div>

        </div>

        <!-- Footer del Correo -->
        <div style="background-color: #111319; padding: 20px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05);">
          <p style="color: #9ca3af; margin: 0; font-size: 12px;">¿Tienes alguna duda o requerimiento especial?</p>
          <p style="margin: 5px 0 0 0; font-size: 12px;"><a href="mailto:contactobuffetgames@gmail.com" style="color: #d4af37; text-decoration: none;">Escríbenos a contactobuffetgames@gmail.com</a></p>
        </div>
      </div>
      `;

      await transporter.sendMail({
        from: `"Concordia Producciones" <${process.env.GMAIL_USER}>`,
        to: clienteEmail,
        subject: `🎟️ Tu Boleto Confirmado - Folio #${folio} - Concordia Producciones`,
        html: emailCompradorHtml,
        attachments: [
          {
            filename: 'logo.png',
            path: path.join(__dirname, '..', 'logo.png'),
            cid: 'concordialogo',
            contentDisposition: 'inline'
          }
        ]
      }).catch(e => console.error('Error al enviar correo al comprador:', e.message));
    }

    // 3. ENVIAR CORREO DE ALERTA AL COMERCIANTE / ORGANIZADOR
    const merchantEmail = process.env.MERCHANT_EMAIL || process.env.GMAIL_USER;
    if (merchantEmail) {
      const emailMerchantHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #0a0b0e; padding: 20px; text-align: center;">
          <img src="cid:concordialogo" alt="Concordia Producciones" style="max-height: 50px;" />
        </div>
        <div style="padding: 20px;">
          <h2 style="color: #00b074; margin-top: 0;">🛒 ¡Nueva Venta de Boleto! (#${folio})</h2>
          <p>Se ha registrado un pago exitoso por medio de Stripe para el Evento de Networking.</p>
          
          <table style="width:100%; border:1px solid #ddd; border-collapse:collapse; margin-top:20px;">
            <tr style="background:#f9f9f9;">
              <th style="padding:10px; border:1px solid #ddd; text-align:left;">Campo</th>
              <th style="padding:10px; border:1px solid #ddd; text-align:left;">Detalle</th>
            </tr>
            <tr>
              <td style="padding:10px; border:1px solid #ddd;"><strong>Folio de Venta</strong></td>
              <td style="padding:10px; border:1px solid #ddd; color:#d4af37; font-weight:bold;">#${folio}</td>
            </tr>
            <tr>
              <td style="padding:10px; border:1px solid #ddd;"><strong>Cliente</strong></td>
              <td style="padding:10px; border:1px solid #ddd; font-weight:bold;">${clienteNombre}</td>
            </tr>
            <tr>
              <td style="padding:10px; border:1px solid #ddd;"><strong>Email</strong></td>
              <td style="padding:10px; border:1px solid #ddd;"><a href="mailto:${clienteEmail}">${clienteEmail}</a></td>
            </tr>
            <tr>
              <td style="padding:10px; border:1px solid #ddd;"><strong>Teléfono</strong></td>
              <td style="padding:10px; border:1px solid #ddd;">${clienteTelefono}</td>
            </tr>
            <tr>
              <td style="padding:10px; border:1px solid #ddd;"><strong>Negocio / Marca</strong></td>
              <td style="padding:10px; border:1px solid #ddd;">${clienteNegocio}</td>
            </tr>
            <tr>
              <td style="padding:10px; border:1px solid #ddd;"><strong>Giro Comercial</strong></td>
              <td style="padding:10px; border:1px solid #ddd;">${clienteGiro}</td>
            </tr>
            <tr>
              <td style="padding:10px; border:1px solid #ddd;"><strong>Cantidad Boletos</strong></td>
              <td style="padding:10px; border:1px solid #ddd; font-weight:bold;">${cantidad}</td>
            </tr>
            <tr>
              <td style="padding:10px; border:1px solid #ddd;"><strong>Monto Pagado</strong></td>
              <td style="padding:10px; border:1px solid #ddd; color:#00b074; font-weight:bold;">$${total.toLocaleString('es-MX')} MXN</td>
            </tr>
          </table>
          
          <p style="margin-top:20px; font-size:12px; color:#666;">Este registro ya ha sido añadido automáticamente a la pestaña <strong>${SHEET_TAB}</strong> en tu Google Sheets.</p>
        </div>
      </div>
      `;

      await transporter.sendMail({
        from: `"Sistema Concordia" <${process.env.GMAIL_USER}>`,
        to: merchantEmail,
        subject: `🔔 Venta Boleto #${folio} - ${clienteNombre} ($${total.toLocaleString('es-MX')} MXN)`,
        html: emailMerchantHtml,
        attachments: [
          {
            filename: 'logo.png',
            path: path.join(__dirname, '..', 'logo.png'),
            cid: 'concordialogo',
            contentDisposition: 'inline'
          }
        ]
      }).catch(e => console.error('Error al enviar correo al comerciante:', e.message));
    }

    res.json({ ok: true, sheets: true, emailSent: true });
  } catch (err) {
    console.error('Error procesando confirmación de pago:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============ ENDPOINTS DE VALIDACIÓN Y CONTROL DE QR ============

// Servir la página de validación móvil
app.get('/validar', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'validar.html'));
});

// Obtener estado y detalles de un boleto por Folio
app.get('/api/validar-boleto', async (req, res) => {
  const { folio } = req.query;
  if (!folio) return res.status(400).json({ error: 'Folio es requerido' });

  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:K`
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No se encontraron registros en el servidor.' });
    }

    // Buscar coincidencia por Folio (index 0)
    let foundBoleto = null;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[0] && row[0].toUpperCase() === folio.trim().toUpperCase()) {
        foundBoleto = {
          folio: row[0],
          fecha: row[1] || '',
          cliente: row[2] || '',
          email: row[3] || '',
          negocio: row[4] || '',
          giro: row[5] || '',
          telefono: row[6] || '',
          cantidad: parseInt(row[7]) || 1,
          total: parseFloat(row[8]) || 0,
          estado: row[9] || 'Válido',
          fechaValidacion: row[10] || ''
        };
        break;
      }
    }

    if (!foundBoleto) {
      return res.status(404).json({ error: 'El folio no corresponde a ningún boleto registrado.' });
    }

    res.json({ ok: true, boleto: foundBoleto });
  } catch (err) {
    console.error('Error al validar boleto:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Inhabilitar boleto (marcar como Usado)
app.post('/api/inhabilitar-boleto', async (req, res) => {
  const { folio } = req.body;
  if (!folio) return res.status(400).json({ error: 'Folio es requerido' });

  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:K`
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No se encontraron registros.' });
    }

    // Buscar coincidencia por Folio
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] && rows[i][0].toUpperCase() === folio.trim().toUpperCase()) {
        rowIndex = i + 1; // Convertir a índice de hoja de cálculo 1-based
        break;
      }
    }

    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Boleto no encontrado.' });
    }

    const fechaVal = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

    // Actualizar Columna J (Estado) y Columna K (Fecha Validación)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!J${rowIndex}:K${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['Usado', fechaVal]]
      }
    });

    console.log(`🎟️ Boleto Folio #${folio} inhabilitado con éxito a las ${fechaVal}`);
    res.json({ ok: true, msg: 'Boleto inhabilitado con éxito.', fechaValidacion: fechaVal });
  } catch (err) {
    console.error('Error al inhabilitar boleto:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fallback para SPA en producción y local
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ============ INICIAR SERVIDOR LOCAL ============
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Servidor de Boletos corriendo en http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
