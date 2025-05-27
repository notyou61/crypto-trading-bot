const axios = require('axios');

const API_KEY = 'a15eb8c70f8643a39b325c26910e5c90';
const TEST_MINT = '8fLJCxZiMDd4e5wsXAGWEDdX7q2UgdW7EKeQU7jypump';

async function test() {
  try {
    const res = await axios.get(`https://public-api.birdeye.so/public/price?address=${TEST_MINT}`, {
      headers: { 'X-API-KEY': API_KEY }
    });
    console.log('✅ Success:', res.data);
  } catch (err) {
    console.error('❌ Key failed:', err.response?.data || err.message);
  }
}

test();
