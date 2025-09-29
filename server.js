require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'VIP Reformas Scraper',
    timestamp: new Date().toISOString()
  });
});

// Endpoint para verificar si un trabajo existe
app.post('/check-work', async (req, res) => {
  const { work_id } = req.body;
  
  if (!work_id) {
    return res.status(400).json({ error: 'work_id es requerido' });
  }

  console.log(`🔍 Verificando work_id: ${work_id}`);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // 1. Login
    console.log('📝 Realizando login...');
    await page.goto('https://www.vipreformas.es/registro-profesionales', { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.type('#proEmail', process.env.VIP_EMAIL);
    await page.type('#proPasswd', process.env.VIP_PASSWORD);
    await page.click('button[type="submit"]');
    
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    // Verificar login exitoso
    const currentUrl = page.url();
    if (!currentUrl.includes('zona-profesionales')) {
      throw new Error('Login fallido');
    }

    // 2. Verificar si el trabajo existe
    console.log(`🔎 Navegando a work_id: ${work_id}`);
    await page.goto(`https://www.vipreformas.es/detalle-trabajo/${work_id}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    const exists = await page.evaluate(() => {
      const errorElements = document.querySelectorAll('.error, .not-found, [class*="error"]');
      const pageText = document.body.textContent;
      
      return errorElements.length === 0 && 
             !pageText.includes('página no existe') &&
             !pageText.includes('no encontrado');
    });

    await browser.close();

    console.log(`✅ Work ${work_id}: ${exists ? 'EXISTE' : 'NO EXISTE'}`);

    res.json({
      work_id,
      exists,
      timestamp: new Date().toISOString(),
      success: true
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error(`❌ Error con work ${work_id}:`, error.message);
    
    res.status(500).json({
      error: error.message,
      work_id,
      exists: false,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para obtener datos completos del trabajo
app.post('/get-work-data', async (req, res) => {
  const { work_id } = req.body;
  
  if (!work_id) {
    return res.status(400).json({ error: 'work_id es requerido' });
  }

  console.log(`📊 Obteniendo datos para work_id: ${work_id}`);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // 1. Login
    console.log('📝 Realizando login...');
    await page.goto('https://www.vipreformas.es/registro-profesionales', { 
      waitUntil: 'networkidle2' 
    });

    await page.type('#proEmail', process.env.VIP_EMAIL);
    await page.type('#proPasswd', process.env.VIP_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // 2. Navegar al trabajo específico
    console.log(`🔎 Navegando a work_id: ${work_id}`);
    await page.goto(`https://www.vipreformas.es/detalle-trabajo/${work_id}`, {
      waitUntil: 'networkidle2'
    });

    // 3. Extraer todos los datos
    console.log('📋 Extrayendo datos...');
    const workData = await page.evaluate(() => {
      // Función helper para extraer valores
      const extractValue = (selectors, attribute = 'value') => {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            if (attribute === 'textContent') {
              return element.textContent?.trim() || '';
            } else {
              return element[attribute] || element.getAttribute(attribute) || '';
            }
          }
        }
        return '';
      };

      // Extraer nombre
      const nombre = extractValue([
        'input.tituloObra[value]',
        '.readonly.small.tituloObra'
      ], 'value');

      // Extraer teléfono
      const telefono = extractValue([
        '.grupoCampo:has(label[for="tel1"]) input',
        'a.lab-field input'
      ], 'value');

      // Extraer email
      const email = extractValue([
        '.zonaDerecha .grupoCampo:nth-child(3) input'
      ], 'value');

      // Extraer fecha de reserva
      const fechaReserva = extractValue([
        '.grupoCampo:has(label[for="fReserva"]) input'
      ], 'value');

      // Extraer work_id del título
      let workId = '';
      const titleSpan = Array.from(document.querySelectorAll('span'))
        .find(span => span.textContent.includes('DETALLE DEL TRABAJO con ID'));
      
      if (titleSpan) {
        const match = titleSpan.textContent.match(/ID\s+(\d+)/);
        workId = match ? match[1] : '';
      }

      // Determinar status del lead
      let leadStatus = 'pendiente';
      const statusElements = document.querySelectorAll('[class*="estado"], [class*="status"], .precioObra');
      for (let el of statusElements) {
        const texto = el.textContent.toLowerCase();
        if (texto.includes('cerrada') || texto.includes('completado')) {
          leadStatus = 'completado';
          break;
        }
      }

      return {
        work_id: workId,
        nombre,
        telefono,
        email,
        fecha_reserva: fechaReserva,
        lead_status: leadStatus,
        scraped_at: new Date().toISOString()
      };
    });

    await browser.close();

    console.log(`✅ Datos extraídos para work ${work_id}:`, workData);

    res.json({
      work_id,
      success: true,
      data: workData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error(`❌ Error obteniendo datos para work ${work_id}:`, error.message);
    
    res.status(500).json({
      error: error.message,
      work_id,
      success: false,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para búsqueda en la lista de trabajos
app.post('/search-works', async (req, res) => {
  const { search_text } = req.body;
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Login
    await page.goto('https://www.vipreformas.es/registro-profesionales');
    await page.type('#proEmail', process.env.VIP_EMAIL);
    await page.type('#proPasswd', process.env.VIP_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForNavigation();

    // Navegar a trabajos recibidos
    await page.goto('https://www.vipreformas.es/trabajos-recibidos/');

    // Realizar búsqueda si se proporciona texto
    if (search_text) {
      await page.type('#texto_libre', search_text);
      await page.click('a.button-link.dark-blue');
      await page.waitForTimeout(3000);
    }

    // Extraer precios de la lista
    const preciosData = await page.evaluate(() => {
      const precios = [];
      const precioElements = document.querySelectorAll('.fecha-tabl.v-desktop');
      
      precioElements.forEach(element => {
        const texto = element.textContent;
        if (texto.includes('Precio de Contacto:')) {
          const match = texto.match(/(\d+[\.,]?\d*)\s*€/);
          if (match) {
            const precio = parseFloat(match[1].replace(',', '.'));
            precios.push(precio);
          }
        }
      });

      return {
        precios,
        primer_precio: precios.length > 0 ? precios[0] : 9,
        promedio: precios.length > 0 ? 
          Math.round((precios.reduce((a, b) => a + b, 0) / precios.length) * 100) / 100 : 9,
        total_trabajos: precios.length
      };
    });

    await browser.close();

    res.json({
      success: true,
      search_text,
      ...preciosData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📧 Email configurado: ${process.env.VIP_EMAIL ? '✅' : '❌'}`);
  console.log(`🔐 Password configurado: ${process.env.VIP_PASSWORD ? '✅' : '❌'}`);
});