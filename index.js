const { Client, GatewayIntentBits } = require('discord.js');
const puppeteer = require('puppeteer');

const token = process.env.DISCORD_BOT_TOKEN;

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
  await page.type('input[placeholder="Enter your name"]', guestName, { delay: 10 });

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

  if (apiResponseData) {
    const items = apiResponseData.data.draftOrder.shoppingCart.items || [];

    const parsedItems = items.map(item => {
      const customizations = [];
      if (item.customizations) {
        for (const key in item.customizations) {
          const custList = item.customizations[key];
          custList.forEach(cust => {
            customizations.push({
              title: cust.title,
              price: cust.price / 100,
              quantity: cust.quantity,
            });
          });
        }
      }

      return {
        title: item.title,
        quantity: item.quantity,
        pricePerItem: item.price / 100,
        totalPrice: (item.price * item.quantity) / 100,
        customizations,
      };
    });

    console.log('✅ Parsed API Order Items:\n', JSON.stringify(parsedItems, null, 2));
  } else {
    console.warn('⚠️ API response was not captured.');
  }

  await browser.close();

  return {
    apiResponse: apiResponseData,
  };
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', () => {
  console.log('Discord bot ready!');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('!ubereats ')) {
    const args = message.content.split(' ');
    if (args.length < 2) {
      message.channel.send('❌ Please provide the Uber Eats group order link!');
      return;
    }
    const groupLink = args[1];
    const guestName = args[2] || 'Guest Tester';

    message.channel.send(`⏳ Scraping Uber Eats order for **${guestName}**... Please wait.`);

    try {
      const result = await scrapeUberEatsGroup(groupLink, guestName);

      if (!result.apiResponse) {
        message.channel.send('⚠️ Failed to get order data.');
        return;
      }

      const items = result.apiResponse.data.draftOrder.shoppingCart.items || [];
      if (items.length === 0) {
        message.channel.send('No items found in the group order.');
        return;
      }

      let reply = '**Order Items:**\n';
      items.forEach((item, i) => {
        reply += `\n**${i + 1}. ${item.title}**\nQty: ${item.quantity}, Price per item: $${(item.price / 100).toFixed(2)}\n`;
        if (item.customizations) {
          for (const key in item.customizations) {
            const custList = item.customizations[key];
            custList.forEach(cust => {
              reply += ` - ${cust.title} x${cust.quantity} (+$${(cust.price / 100).toFixed(2)})\n`;
            });
          }
        }
      });

      if (reply.length > 1900) reply = reply.slice(0, 1900) + '\n... (truncated)';

      message.channel.send(reply);
    } catch (err) {
      console.error(err);
      message.channel.send(`❌ Error scraping the group order: ${err.message}`);
    }
  }
});

client.login(token);
