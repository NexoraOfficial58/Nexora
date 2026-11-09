require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');

const app = express();

app.use(cors());
app.use(express.static('public'));

// Webhook Stripe
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error(`❌ Erreur Webhook Stripe : ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_details ? session.customer_details.email : null;
        const userPrompt = session.metadata ? session.metadata.user_project_idea : "Application SaaS";

        if (customerEmail) {
            generateAndDeliverProject(customerEmail, userPrompt);
        }
    }

    res.json({ received: true });
});

app.use(express.json());

// Création de session de paiement
app.post('/create-checkout-session', async (req, res) => {
    try {
        const { idea } = req.body;

        if (!idea || idea.trim() === '') {
            return res.status(400).json({ error: "L'idée du projet est requise." });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: 'NEXORA Pro - Déploiement SaaS',
                            description: `Génération et code source pour : "${idea.substring(0, 50)}..."`,
                        },
                        unit_amount: 2900, // 29.00 €
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            metadata: {
                user_project_idea: idea,
            },
            success_url: `${req.headers.origin}/?success=true`,
            cancel_url: `${req.headers.origin}/?canceled=true`,
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error("❌ Erreur création session Stripe :", error);
        res.status(500).json({ error: error.message });
    }
});

// Génération IA et envoi mail
async function generateAndDeliverProject(email, idea) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

        const promptIA = `Tu es un développeur full-stack expert. Génère le code HTML, CSS (via CDN TailwindCSS) et JS complet, moderne, réactif et directement fonctionnel pour une application SaaS basée sur l'idée suivante du client : "${idea}". Le code doit contenir un tableau de bord complet, des modules d'action interactifs et des données de démonstration réalistes. Renvoie UNIQUEMENT le code HTML complet à l'intérieur d'un document standalone sans explications supplémentaires.`;

        const result = await model.generateContent(promptIA);
        const generatedCode = result.response.text();

        await sendProjectEmail(email, idea, generatedCode);
    } catch (error) {
        console.error("❌ Erreur lors du traitement du projet :", error);
    }
}

async function sendProjectEmail(email, idea, code) {
    let transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '465'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    const cleanCode = code.replace(/```html/g, '').replace(/```/g, '').trim();

    await transporter.sendMail({
        from: `"NEXORA AI" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `🚀 Votre logiciel SaaS "${idea}" est prêt !`,
        html: `
            <div style="font-family: Arial, sans-serif; background-color: #070b18; color: #ffffff; padding: 30px; border-radius: 12px;">
                <h1 style="color: #4ca5ff;">Félicitations !</h1>
                <p style="font-size: 16px; color: #a5b1ca;">Votre application SaaS basée sur l'idée <strong>"${idea}"</strong> a été générée avec succès.</p>
                <hr style="border-color: rgba(255,255,255,0.1);" />
                <h3>Code Source complet (index.html)</h3>
                <textarea style="width: 100%; height: 350px; background: #080e1d; color: #4ade80; border: 1px solid rgba(255,255,255,0.2); padding: 15px; font-family: monospace; border-radius: 8px;" readonly>${cleanCode}</textarea>
            </div>
        `,
        attachments: [
            {
                filename: 'index.html',
                content: cleanCode,
                contentType: 'text/html'
            }
        ]
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur NEXORA prêt sur le port ${PORT}`);
});
