require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express(); 

app.use(cors());
// CORRECTION : On pointe vers le dossier racine (__dirname) et non 'public'
app.use(express.static(__dirname));

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
