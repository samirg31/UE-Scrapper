const { Client, GatewayIntentBits } = require('discord.js');
const puppeteer = require('puppeteer');

async function scrapeUberEatsGroup(groupUrl, guestName = 'Guest Tester') {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-background-timer-throttling',
    ],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(10000);

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
      request.abort();
    } else {
      request.continue();
    }
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36'
  );

  console.log('▶️ Loading group order page...');
  await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.waitForSelector('input[placeholder="Enter your name"]');
  await page.type('input[placeholder="Enter your name"]', guestName, { delay: 10 }); // faster typing

  const apiResponsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('API response timeout')), 4000);
    page.on('response', async (response) => {
      try {
        if (response.url().includes('getDraftOrderByUuidV2')) {
          clearTimeout(timeout);
          const data = await response.json();
          resolve(data);
        }
      } catch (err) {}
    });
  });

  const [joinBtn] = await page.$x("//button[contains(., 'Join order') and not(@disabled)]");
  if (!joinBtn) throw new Error('Join order button not found');
  await joinBtn.click();
  console.log('✅ “Join order” clicked');

  await page.waitForTimeout(1000);

  let apiResponseData;
  try {
    apiResponseData = await apiResponsePromise;
  } catch (e) {
    console.warn('⚠️ Failed to capture API response:', e.message);
  }

  await browser.close();

  return apiResponseData;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const token = process.env.DISCORD_TOKEN;

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('!scrape ')) {
    const args = message.content.split(' ');
    const groupLink = args[1];
    if (!groupLink) {
      return message.reply('❌ Please provide the Uber Eats group order link.');
    }

    await message.reply('⏳ Scraping started, please wait...');

    try {
      const apiResponseData = await scrapeUberEatsGroup(groupLink, message.author.username);

      if (apiResponseData && apiResponseData.data && apiResponseData.data.draftOrder) {
        const items = apiResponseData.data.draftOrder.shoppingCart.items || [];

        if (items.length === 0) {
          return message.reply('⚠️ No items found in the order.');
        }

        let replyText = '🛒 **Order Items:**\n';
        items.forEach((item) => {
          replyText += `- ${item.quantity}x ${item.title} ($${(item.price / 100).toFixed(2)} each)\n`;

          if (item.customizations) {
            for (const key in item.customizations) {
              item.customizations[key].forEach(cust => {
                replyText += `    • ${cust.title} x${cust.quantity} ($${(cust.price / 100).toFixed(2)})\n`;
              });
            }
          }
        });

        message.reply(replyText);
      } else {
        message.reply('⚠️ Could not retrieve order data.');
      }
    } catch (error) {
      console.error(error);
      message.reply(`❌ Error scraping order: ${error.message}`);
    }
  }
});

client.login(token);
