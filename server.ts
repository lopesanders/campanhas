import express from "express";
import { createServer as createViteServer } from "vite";
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Supabase setup
let supabaseClient: any = null;
function getSupabase() {
  if (!supabaseClient) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) is missing in environment variables.");
    }
    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseClient;
}

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Vercel limit is 4.5MB anyway

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
    
    const supabase = getSupabase();
    // Save campaign as 'pending' initially. It will be approved via redirect or webhook.
    const { error: insertError } = await supabase
      .from('campaigns')
      .insert([
        { id: campaignId, name, frame_image, status: 'pending' }
      ]);

    if (insertError) throw insertError;

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

app.get("/api/campaigns", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, name')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/campaigns/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { force_approve } = req.query;
    const supabase = getSupabase();

    // If coming from a successful redirect, we can optimistically approve it
    if (force_approve === 'true') {
      await supabase
        .from('campaigns')
        .update({ status: 'approved' })
        .eq('id', id);
    }

    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (data) {
      res.json(data);
    } else {
      res.status(404).json({ error: "Campaign not found" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/campaigns/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const supabase = getSupabase();

    if (password !== '914614@mL') {
      return res.status(401).json({ error: "Senha incorreta" });
    }

    const { error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', id);

    if (error) throw error;
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
      const supabase = getSupabase();
      
      if (p.status === "approved" && p.external_reference) {
        await supabase
          .from('campaigns')
          .update({ status: 'approved' })
          .eq('id', p.external_reference);
      }
    } catch (error) {
      console.error("Webhook Error:", error);
    }
  }

  res.sendStatus(200);
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } else if (!process.env.VERCEL) {
    // Local production mode
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
