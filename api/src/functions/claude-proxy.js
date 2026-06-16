const { app } = require('@azure/functions');

app.http('claude-proxy', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'claude',
    handler: async (request, context) => {

        // CORS preflight
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
        };

        if (request.method === 'OPTIONS') {
            return {
                status: 204,
                headers: corsHeaders
            };
        }

        // Validate API key is set
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            context.error('ANTHROPIC_API_KEY environment variable not set');
            return {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Proxy not configured — ANTHROPIC_API_KEY missing' })
            };
        }

        // Forward the request body to Anthropic
        let body;
        try {
            body = await request.json();
        } catch (e) {
            return {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid JSON body' })
            };
        }

        // Safety: only allow messages endpoint, enforce model whitelist
        const allowedModels = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
        if (body.model && !allowedModels.includes(body.model)) {
            return {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Model not permitted by proxy policy' })
            };
        }

        // Cap max_tokens to avoid runaway costs
        if (!body.max_tokens || body.max_tokens > 2000) {
            body.max_tokens = 1000;
        }

        try {
            const upstream = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(body)
            });

            const data = await upstream.json();

            return {
                status: upstream.status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            };

        } catch (e) {
            context.error('Upstream Anthropic request failed:', e);
            return {
                status: 502,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Upstream request failed: ' + e.message })
            };
        }
    }
});
