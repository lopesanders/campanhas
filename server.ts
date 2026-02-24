import express from "express";
import { createServer as createViteServer } from "vite";
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';
import Database from 'better-sqlite3';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

// Database setup
const db = new Database('payments.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT,
    frame_image TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Mercado Pago lazy initialization
let mpClient: MercadoPagoConfig | null = null;

function getMPClient() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Mercado Pago access token (MP_ACCESS_TOKEN) is not configured in Secrets.");
  }
  if (!mpClient) {
    mpClient = new MercadoPagoConfig({ 
      accessToken: token,
      options: { timeout: 5000 }
    });
  }
  return mpClient;
}

// API Routes
app.post("/api/campaigns", async (req, res) => {
  try {
    const { name, frame_image } = req.body;
    if (!name || !frame_image) {
      return res.status(400).json({ error: "Name and frame_image are required" });
    }

    const client = getMPClient();
    const preference = new Preference(client);
    const campaignId = `camp-${Date.now()}`;
    
    // Determine base URL dynamically if APP_URL is not set
    const host = req.get('host') || '';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = process.env.APP_URL || req.headers.origin || `${protocol}://${host}`;
    
    // Save campaign as 'pending' initially. It will be approved via redirect or webhook.
    db.prepare('INSERT INTO campaigns (id, name, frame_image, status) VALUES (?, ?, ?, ?)').run(campaignId, name, frame_image, 'pending');

    const body = {
      items: [
        {
          id: 'criacao-campanha',
          title: `Criação de Campanha: ${name}`,
          quantity: 1,
          unit_price: 29.99,
          currency_id: 'BRL'
        }
      ],
      back_urls: {
        success: `${baseUrl}/?payment_status=approved&campaign_id=${campaignId}`,
        failure: `${baseUrl}/?payment_status=failed`,
        pending: `${baseUrl}/?payment_status=pending`,
      },
      auto_return: 'approved',
      notification_url: `${baseUrl}/api/webhook`,
      statement_descriptor: 'CAMPANHA_DIGITAL',
      external_reference: campaignId
    };

    const result = await preference.create({ body });
    res.json({ id: campaignId, init_point: result.init_point });
  } catch (error: any) {
    console.error("MP Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/campaigns", (req, res) => {
  try {
    const rows = db.prepare('SELECT id, name FROM campaigns WHERE status = ? ORDER BY created_at DESC').all('approved');
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/campaigns/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { force_approve } = req.query;

    // If coming from a successful redirect, we can optimistically approve it
    if (force_approve === 'true') {
      db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run('approved', id);
    }

    const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    if (row) {
      res.json(row);
    } else {
      res.status(404).json({ error: "Campaign not found" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/campaigns/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (password !== '914614') {
      return res.status(401).json({ error: "Senha incorreta" });
    }

    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/webhook", async (req, res) => {
  const { action, data, type } = req.body;

  // Webhook can be for payment or merchant_order
  if (type === "payment" && data?.id) {
    try {
      const client = getMPClient();
      const payment = new Payment(client);
      const p = await payment.get({ id: data.id }) as any;
      
      if (p.status === "approved" && p.external_reference) {
        db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run('approved', p.external_reference);
      }
    } catch (error) {
      console.error("Webhook Error:", error);
    }
  }

  res.sendStatus(200);
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
