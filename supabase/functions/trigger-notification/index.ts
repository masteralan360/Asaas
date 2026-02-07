import { Novu } from '@novu/node';

// Setup Novu with the secret API Key
const novu = new Novu(Deno.env.get('NOVU_API_KEY') || '');

Deno.serve(async (req) => {
    try {
        const { subscriberId, workflowId, payload } = await req.json();

        if (!subscriberId || !workflowId) {
            return new Response(JSON.stringify({ error: 'Missing subscriberId or workflowId' }), { status: 400 });
        }

        // Trigger the notification
        const result = await novu.trigger(workflowId, {
            to: {
                subscriberId: subscriberId,
            },
            payload: payload || {},
        });

        return new Response(JSON.stringify(result.data), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
});
