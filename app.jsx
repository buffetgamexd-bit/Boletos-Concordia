// Componente de Logotipo Oficial de Concordia
function ConcordiaLogo({ width = 200, height = 80 }) {
  return (
    <img 
      src="logo.png" 
      alt="Concordia Jones Audio Logo" 
      style={{ 
        width: width, 
        height: 'auto', 
        maxHeight: height,
        display: 'block', 
        margin: '0 auto',
        objectFit: 'contain'
      }} 
    />
  );
}

function App() {
  // --- ESTADOS PRINCIPALES ---
  const [modalOpen, setModalOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [successData, setSuccessData] = React.useState(null);
  const [paymentStatus, setPaymentStatus] = React.useState('normal'); // normal | success | cancel
  
  // Datos del formulario de registro
  const [formData, setFormData] = React.useState({
    nombre: '',
    apellidos: '',
    negocio: '',
    giro: '',
    telefono: '',
    email: '',
    qty: 1
  });

  // --- DETECTAR REDIRECCIÓN DE PAGO (URL) ---
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pago = params.get('pago');
    const sessionId = params.get('session_id');

    if (pago === 'ok' && sessionId) {
      setPaymentStatus('success');
      setLoading(true);
      
      // 1. Obtener detalles de la compra desde el backend
      fetch(`/session-details?id=${sessionId}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          setSuccessData(data);
          
          // 2. Disparar proceso de confirmación de correo y Google Sheets
          return fetch('/send-confirmacion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId })
          });
        })
        .then(res => res.json())
        .then(resData => {
          console.log('Confirmación automatizada enviada:', resData);
          setLoading(false);
        })
        .catch(err => {
          console.error('Error procesando confirmación de pago:', err);
          setLoading(false);
        });
    } else if (pago === 'cancelado') {
      setPaymentStatus('cancel');
    }
  }, []);

  // --- MANEJADORES DE ENTRADAS ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleQtyChange = (val) => {
    const newQty = formData.qty + val;
    if (newQty >= 1 && newQty <= 10) {
      setFormData(prev => ({ ...prev, qty: newQty }));
    }
  };

  // --- ENVIAR A STRIPE ---
  const handleCheckoutSubmit = (e) => {
    e.preventDefault();
    setLoading(true);

    fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    })
      .then(res => res.json())
      .then(data => {
        if (data.url) {
          // Redirigir al checkout seguro de Stripe
          window.location.href = data.url;
        } else {
          alert('Error al crear la sesión de pago: ' + (data.error || 'Intente nuevamente.'));
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('Error checkout:', err);
        alert('Error de conexión con el servidor.');
        setLoading(false);
      });
  };

  const handlePrint = () => {
    window.print();
  };

  const handleReset = () => {
    // Limpiar url y regresar a inicio
    window.location.href = window.location.origin + window.location.pathname;
  };

  // =========================================================================
  // RENDER 1: PANTALLA DE ÉXITO (VIP BOARDING PASS TICKET)
  // =========================================================================
  if (paymentStatus === 'success') {
    return (
      <div className="landing-container">
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1.5rem' }}>
            <div className="loader-spinner" style={{ width: '50px', height: '50px', borderLeftColor: '#d4af37' }}></div>
            <h3 style={{ color: '#d4af37', fontFamily: 'var(--font-serif)', fontSize: '1.5rem' }}>Procesando tu Registro VIP...</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Generando pase QR y enviando confirmación por correo.</p>
          </div>
        ) : successData ? (
          <div className="success-card">
            <div className="success-badge">
              <i className="fa-solid fa-check"></i>
            </div>
            <h1 className="success-title">¡Registro de Acceso Confirmado!</h1>
            <p className="success-desc">
              Hola <strong>{successData.nombreCompleto}</strong>, tu pase de abordaje VIP se ha registrado con éxito en el sistema. Hemos enviado tu boleto oficial en formato digital y los detalles del evento a tu correo <strong>{successData.email}</strong>.
            </p>

            {/* PASE DE ABORDAR PREMIUM IMPRIMIBLE */}
            <div className="boarding-pass" id="printable-ticket">
              <div className="pass-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem' }}>
                <div style={{ transform: 'scale(0.8)', transformOrigin: 'left center' }}>
                  <ConcordiaLogo width={160} height={60} />
                </div>
                <span className="pass-folio" style={{ fontSize: '0.95rem' }}>FOLIO: #{successData.folio}</span>
              </div>
              <div className="pass-body">
                <div>
                  <p className="pass-field-label">ASISTENTE</p>
                  <p className="pass-field-value">{successData.nombreCompleto}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p className="pass-field-label">TIPO ACCESO</p>
                  <p className="pass-field-value gold">CONEXIÓN VIP</p>
                </div>
                <div>
                  <p className="pass-field-label">NEGOCIO / MARCA</p>
                  <p className="pass-field-value">{successData.negocio}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p className="pass-field-label">GIRO COMERCIAL</p>
                  <p className="pass-field-value">{successData.giro}</p>
                </div>
                <div>
                  <p className="pass-field-label">CANTIDAD BOLETOS</p>
                  <p className="pass-field-value gold">{successData.cantidad} {successData.cantidad === 1 ? 'Acceso' : 'Accesos'}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p className="pass-field-label">TOTAL PAGADO</p>
                  <p className="pass-field-value">$MXN {successData.total.toLocaleString('es-MX')}</p>
                </div>
                
                <div className="pass-footer" style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '1.5rem', marginTop: '1rem' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>📍 UBICACIÓN</span>
                    <strong style={{ fontSize: '13px', color: '#fff' }}>Club Altozano Qro.</strong>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>🗓️ FECHA Y HORA</span>
                    <strong style={{ fontSize: '13px', color: '#fff' }}>3 Jun 2026 | 7:00 PM</strong>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '2rem' }}>
              <button className="btn-primary" onClick={handlePrint}>
                <i className="fa-solid fa-print"></i> Imprimir Pase / Guardar PDF
              </button>
              <button className="btn-primary btn-emerald" onClick={handleReset}>
                <i className="fa-solid fa-house"></i> Volver al Inicio
              </button>
            </div>
          </div>
        ) : (
          <div className="success-card" style={{ padding: '4rem 2rem' }}>
            <div className="success-badge" style={{ borderColor: 'red', color: 'red', background: 'rgba(255,0,0,0.1)' }}>
              <i className="fa-solid fa-xmark"></i>
            </div>
            <h1 className="success-title" style={{ color: '#ff4d4d' }}>Error de Sincronización</h1>
            <p className="success-desc">
              No pudimos recuperar los detalles del registro en este momento. Sin embargo, si tu pago con Stripe fue exitoso, recibirás la confirmación en tu correo a la brevedad.
            </p>
            <button className="btn-primary" onClick={handleReset}>Volver a intentar</button>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // RENDER 2: PANTALLA DE CANCELADO
  // =========================================================================
  if (paymentStatus === 'cancel') {
    return (
      <div className="landing-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh' }}>
        <div className="success-card" style={{ maxWidth: '500px' }}>
          <div className="success-badge" style={{ borderColor: '#f59e0b', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)' }}>
            <i className="fa-solid fa-triangle-exclamation"></i>
          </div>
          <h1 className="success-title">Pago Cancelado</h1>
          <p className="success-desc">
            El proceso de pago fue cancelado y no se ha realizado ningún cargo. Si tuviste inconvenientes con tu tarjeta, puedes volver a intentarlo cuando gustes.
          </p>
          <button className="btn-primary" onClick={handleReset}>
            Volver a Intentar
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // RENDER 3: LANDING PAGE PRINCIPAL
  // =========================================================================
  return (
    <div className="landing-container">
      
      {/* HEADER DE LA PÁGINA */}
      <header className="header" style={{ padding: '0.8rem 2rem' }}>
        <a href="#" className="logo-container" style={{ display: 'flex', alignItems: 'center' }}>
          <ConcordiaLogo width={170} height={70} />
        </a>
        <div className="nav-actions">
          <div className="event-date-badge">
            <i className="fa-regular fa-calendar-check"></i> 3 DE JUNIO 2026 I 7:00 PM
          </div>
        </div>
      </header>

      {/* SECCIÓN HERO */}
      <main className="hero-section">
        <div className="hero-content">
          <p className="hero-tag">
            <i className="fa-solid fa-star"></i> Evento de Networking de Alto Nivel
          </p>
          <h1 className="hero-title" style={{ fontSize: '3.3rem' }}>
            CONEXIÓN Y NEGOCIOS <span>NETWORKING</span>
          </h1>
          <p className="hero-subtitle">
            ¡Hola! Gracias por tu interés en nuestro evento exclusivo de networking. Te invitamos a una experiencia diseñada para conectar con empresarios, líderes y profesionales en un ambiente relajado, selecto y estratégico en Querétaro.
          </p>
          
          <div className="event-quick-details">
            <div className="quick-detail-item">
              <i className="fa-regular fa-clock quick-detail-icon"></i>
              <div className="quick-detail-text">
                <p>Fecha y Hora</p>
                <p>3 de Junio • 7:00 PM</p>
              </div>
            </div>
            <div className="quick-detail-item">
              <i className="fa-solid fa-map-pin quick-detail-icon"></i>
              <div className="quick-detail-text">
                <p>Ubicación</p>
                <p>Club Altozano Querétaro</p>
              </div>
            </div>
          </div>
        </div>

        {/* TARJETA DE VENTA PRINCIPAL (TIPO ENTRADA) */}
        <div className="ticket-card">
          <div className="ticket-header">
            <span className="ticket-phase">CUPO LIMITADO • REGÍSTRATE</span>
            <h3 className="ticket-title">Acceso Personal VIP</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Incluye registro, cena y actividades de valor</p>
            
            <div className="ticket-pricing" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '1rem 0' }}>
              <div style={{ textDecoration: 'line-through', color: 'rgba(255, 255, 255, 0.4)', fontSize: '1.15rem', marginBottom: '0.2rem', fontWeight: '500' }}>
                $1,500 MXN
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center' }}>
                <span className="ticket-price-currency" style={{ color: 'var(--gold-glow)', fontSize: '1.6rem', marginRight: '0.1rem' }}>$</span>
                <span className="ticket-price-amount" style={{ color: 'var(--gold-glow)', fontSize: '3.2rem', fontWeight: '800', lineHeight: 1 }}>1,300</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginLeft: '0.5rem' }}>MXN / persona</span>
              </div>
            </div>
          </div>

          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            <i className="fa-solid fa-ticket"></i> Inscribirme Ahora
          </button>

          <ul className="ticket-features">
            <li className="ticket-feature-item">
              <i className="fa-solid fa-circle-check ticket-feature-icon"></i>
              <span>🍸 <strong>Coctelería premium</strong> de bienvenida</span>
            </li>
            <li className="ticket-feature-item">
              <i className="fa-solid fa-circle-check ticket-feature-icon"></i>
              <span>🍽️ <strong>Cena de 3 tiempos</strong> exclusiva por el Chef</span>
            </li>
            <li className="ticket-feature-item">
              <i className="fa-solid fa-circle-check ticket-feature-icon"></i>
              <span>🤝 <strong>Networking de alto valor</strong> y conexiones reales</span>
            </li>
            <li className="ticket-feature-item">
              <i className="fa-solid fa-circle-check ticket-feature-icon"></i>
              <span>💻 <strong>Presentación mediante Slide</strong> de tu empresa en el evento</span>
            </li>
          </ul>
        </div>
      </main>

      {/* SECCIÓN ILUSTRACIÓN DEL EVENTO */}
      <section className="event-illustration-section" style={{ margin: '4rem 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '3rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-glass)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <img src="concordia_ilustracion.jpeg" alt="Concordia Networking Evento" style={{ width: '100%', height: 'auto', display: 'block' }} className="hover-scale" />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(10,11,14,0.95), transparent)', padding: '3rem 1.5rem 1.5rem' }}>
              <span className="ticket-phase" style={{ fontSize: '0.75rem', marginBottom: '0.5rem', background: 'rgba(212, 175, 55, 0.25)', border: '1px solid rgba(212,175,55,0.4)' }}>CONCORDIA NETWORKING</span>
              <h3 style={{ color: '#fff', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', fontWeight: 'bold' }}>Experiencia de Conexión Empresarial</h3>
            </div>
          </div>
          <div>
            <p className="section-tag" style={{ textAlign: 'left' }}>CONEXIÓN ESTRATÉGICA</p>
            <h2 className="section-title" style={{ textAlign: 'left', fontSize: '2.2rem', marginTop: '0.5rem', marginBottom: '1.5rem' }}>Impulsa tu Red de Contactos</h2>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.7', marginBottom: '1.2rem', fontSize: '1.05rem' }}>
              El Networking es la herramienta más poderosa para acelerar el crecimiento de tu negocio. Este no es solo un evento de intercambio de tarjetas; es un espacio diseñado al detalle para entablar relaciones de confianza a largo plazo con directores, tomadores de decisiones y dueños de negocio.
            </p>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.7', fontSize: '1.05rem' }}>
              Disfruta de una atmósfera sumamente selecta, diseñada para inspirar colaboración, sinergias comerciales y nuevas oportunidades de inversión.
            </p>
          </div>
        </div>
      </section>

      {/* SECCIÓN BENEFICIOS: ¿QUÉ VAS A VIVIR? */}
      <section>
        <div className="section-title-wrapper">
          <p className="section-tag">UNA EXPERIENCIA QUE CONECTA NEGOCIOS REALES</p>
          <h2 className="section-title">¿Qué Incluye tu Acceso?</h2>
        </div>

        <div className="benefits-grid">
          <div className="benefit-card">
            <div className="benefit-icon-box">
              <i className="fa-solid fa-glass-martini-alt"></i>
            </div>
            <h3 className="benefit-card-title">Coctelería & Bienvenida</h3>
            <p className="benefit-card-desc">
              Inicia la velada en un ambiente premium con mixología selecta para romper el hielo y entablar las primeras conversaciones de valor.
            </p>
          </div>
          
          <div className="benefit-card">
            <div className="benefit-icon-box">
              <i className="fa-solid fa-utensils"></i>
            </div>
            <h3 className="benefit-card-title">Cena de 3 Tiempos</h3>
            <p className="benefit-card-desc">
              Disfruta de una cena gourmet exclusiva de 3 tiempos diseñada especialmente para deleitar el paladar de los líderes empresariales asistentes.
            </p>
          </div>

          <div className="benefit-card">
            <div className="benefit-icon-box">
              <i className="fa-solid fa-handshake"></i>
            </div>
            <h3 className="benefit-card-title">Networking de Alto Valor</h3>
            <p className="benefit-card-desc">
              Estructura alianzas, agenda reuniones y genera oportunidades comerciales estratégicas con empresarios, directores y tomadores de decisiones.
            </p>
          </div>
          
          <div className="benefit-card" style={{ gridColumn: 'span 1' }}>
            <div className="benefit-icon-box">
              <i className="fa-solid fa-desktop"></i>
            </div>
            <h3 className="benefit-card-title">Presenta tu Empresa (Slide)</h3>
            <p className="benefit-card-desc">
              Tendrás la oportunidad de presentar tu empresa, proyecto o servicios mediante una slide en pantalla gigante durante el evento. Facilita que compradores y vendedores te ubiquen y se conecten contigo al instante.
            </p>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <ConcordiaLogo width={180} height={70} />
        <p className="footer-text" style={{ marginTop: '1rem' }}>© 2026 Concordia Producciones. Todos los derechos reservados.</p>
        <div className="footer-socials">
          <a href="https://www.facebook.com/ConcordiaProducciones/" target="_blank" className="footer-social-link"><i className="fa-brands fa-facebook"></i></a>
          <a href="https://www.instagram.com/concordiaproducciones/" target="_blank" className="footer-social-link"><i className="fa-brands fa-instagram"></i></a>
          <a href="https://www.youtube.com/@concordiaproducciones" target="_blank" className="footer-social-link"><i className="fa-brands fa-youtube"></i></a>
        </div>
      </footer>

      {/* BOTÓN MÓVIL PEGAJOSO DE LLAMADA A LA ACCIÓN */}
      <div className="mobile-sticky-btn">
        <button className="btn-primary" onClick={() => setModalOpen(true)}>
          <i className="fa-solid fa-ticket"></i> Inscribirme — $1,300 MXN
        </button>
      </div>

      {/* =========================================================================
         MODAL INTERACTIVO DE REGISTRO VIP
         ========================================================================= */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-container">
            <button className="modal-close" onClick={() => setModalOpen(false)}>
              <i className="fa-solid fa-xmark"></i>
            </button>
            <h2 className="modal-title">Registro VIP</h2>
            <p className="modal-subtitle">Proporciona los datos del asistente para personalizar tu pase digital.</p>
            
            <form onSubmit={handleCheckoutSubmit}>
              
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Nombre *</label>
                  <input 
                    type="text" 
                    name="nombre" 
                    required 
                    placeholder="Escribe tu nombre"
                    className="form-input" 
                    value={formData.nombre} 
                    onChange={handleInputChange} 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Apellidos *</label>
                  <input 
                    type="text" 
                    name="apellidos" 
                    required 
                    placeholder="Apellidos"
                    className="form-input" 
                    value={formData.apellidos} 
                    onChange={handleInputChange} 
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Nombre de tu Negocio, Marca o Servicio *</label>
                <input 
                  type="text" 
                  name="negocio" 
                  required 
                  placeholder="Empresa o proyecto personal"
                  className="form-input" 
                  value={formData.negocio} 
                  onChange={handleInputChange} 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Giro o Actividad Principal *</label>
                <input 
                  type="text" 
                  name="giro" 
                  required 
                  placeholder="Ej. Consultoría, Software, Construcción"
                  className="form-input" 
                  value={formData.giro} 
                  onChange={handleInputChange} 
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Teléfono *</label>
                  <input 
                    type="tel" 
                    name="telefono" 
                    required 
                    placeholder="10 dígitos"
                    className="form-input" 
                    value={formData.telefono} 
                    onChange={handleInputChange} 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Correo Electrónico *</label>
                  <input 
                    type="email" 
                    name="email" 
                    required 
                    placeholder="email@ejemplo.com"
                    className="form-input" 
                    value={formData.email} 
                    onChange={handleInputChange} 
                  />
                </div>
              </div>

              {/* SELECTOR DE CANTIDAD INTERACTIVO */}
              <div className="form-group" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
                <div>
                  <label className="form-label" style={{ margin: 0 }}>Cantidad de Boletos</label>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Máx 10 boletos por transacción</p>
                </div>
                <div className="qty-selector">
                  <button type="button" className="qty-btn" onClick={() => handleQtyChange(-1)}>
                    <i className="fa-solid fa-minus"></i>
                  </button>
                  <span className="qty-val">{formData.qty}</span>
                  <button type="button" className="qty-btn" onClick={() => handleQtyChange(1)}>
                    <i className="fa-solid fa-plus"></i>
                  </button>
                </div>
              </div>

              {/* TOTAL A PAGAR EN TIEMPO REAL */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(212, 175, 55, 0.05)', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid rgba(212, 175, 55, 0.1)', marginBottom: '2rem' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Monto Total:</span>
                <strong style={{ fontSize: '1.4rem', color: 'var(--gold-glow)' }}>
                  $MXN {(formData.qty * 1300).toLocaleString('es-MX')}
                </strong>
              </div>

              <button type="submit" className="btn-primary btn-emerald" style={{ padding: '1.3rem' }} disabled={loading}>
                {loading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div className="loader-spinner"></div> Redirigiendo...
                  </div>
                ) : (
                  <>
                    <i className="fa-solid fa-credit-card"></i> Pagar Boleto
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Renderizar la aplicación React
const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(<App />);
