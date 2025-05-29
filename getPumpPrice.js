// getPumpPrice.js
import fetch from 'node-fetch';

const token = '9NWUanJ4kJZJQiSfDL6bznAFF46QpPKmJ6fadhpMpump';
const url = `https://pump.fun/coin/${token}`;

(async () => {
  try {
    const res = await fetch(url);
    const html = await res.text();

    // Use a broader regex to handle multiline script content
    const jsonMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);

    if (!jsonMatch || !jsonMatch[1]) {
      console.error('❌ Still couldn’t locate JSON in Pump.fun HTML');
      return;
    }

    const data = JSON.parse(jsonMatch[1]);
    const price = data?.props?.pageProps?.tokenData?.priceInSol;

    if (price) {
      console.log(`✅ Price (SOL): ${price}`);
    } else {
      console.log('⚠️ priceInSol not found in JSON structure');
    }
  } catch (err) {
    console.error('❌ Error:', err.message || err);
  }
})();

