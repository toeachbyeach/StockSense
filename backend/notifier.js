const nodemailer = require('nodemailer');
const axios = require('axios');
const db = require('./db');
const log = require('./logger');
const { decrypt } = require('./crypto');
const { getCashbackInfo } = require('./utils/cashback');
const { extractAmazonAsin, isAmazonUrl, buildAmazonCartLink, buildAffiliateUrl } = require('./utils/affiliate');

function isInQuietHours(settings) {
  if (!settings.quietHoursEnabled || !settings.quietHoursStart || !settings.quietHoursEnd) return false;
  try {
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const [sH, sM] = settings.quietHoursStart.split(':').map(Number);
    const [eH, eM] = settings.quietHoursEnd.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const endMins = eH * 60 + eM;

    if (startMins <= endMins) {
      return currentMins >= startMins && currentMins < endMins;
    } else {
      // Over midnight (e.g. 22:00 to 07:00)
      return currentMins >= startMins || currentMins < endMins;
    }
  } catch (e) {
    return false;
  }
}

function buildAlertEmailHtml(subject, message, purchaseUrl, productUrl, options = {}) {
  const escapedSubject = subject.replace(/[&<>"]+/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  })[char] || char);

  const escapedMessage = message.replace(/[&<>"]+/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  })[char] || char).replace(/\n/g, '<br>');

  let priceStatsBox = '';
  if (options.currentPrice != null) {
    const cur = `$${Number(options.currentPrice).toFixed(2)}`;
    const avg = options.avgPrice30d != null ? `$${Number(options.avgPrice30d).toFixed(2)}` : null;
    const diff = options.discountPct != null
      ? (options.discountPct > 0 ? `<span style="color:#059669;font-weight:700;">${Math.abs(options.discountPct).toFixed(1)}% below 30d avg</span>` : `<span style="color:#dc2626;font-weight:700;">${Math.abs(options.discountPct).toFixed(1)}% above 30d avg</span>`)
      : null;

    priceStatsBox = `
      <div style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin:16px 0;display:flex;gap:24px;flex-wrap:wrap;border-left:4px solid #3b82f6;">
        <div>
          <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Current Price</div>
          <div style="font-size:18px;font-weight:700;color:#111827;">${cur}</div>
        </div>
        ${avg ? `
        <div>
          <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">30-Day Average</div>
          <div style="font-size:18px;font-weight:700;color:#4b5563;">${avg}</div>
        </div>` : ''}
        ${diff ? `
        <div>
          <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Difference</div>
          <div style="font-size:16px;margin-top:2px;">${diff}</div>
        </div>` : ''}
        ${options.usedPrice != null ? `
        <div>
          <div style="font-size:12px;color:#d97706;text-transform:uppercase;letter-spacing:0.5px;">Used / Resale Deal</div>
          <div style="font-size:18px;font-weight:700;color:#b45309;">$${Number(options.usedPrice).toFixed(2)}${options.usedCondition ? ` <span style="font-size:12px;color:#92400e;font-weight:normal;">(${options.usedCondition})</span>` : ''}</div>
        </div>` : ''}
      </div>
    `;
  }

  const buttons = [];
  if (purchaseUrl) {
    buttons.push(`<a href="${purchaseUrl}" style="display:inline-block;background:#f59e0b;color:#111827;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;margin-right:8px;margin-bottom:8px;">Add to Amazon Cart</a>`);
  }
  if (productUrl) {
    buttons.push(`<a href="${productUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;margin-right:8px;margin-bottom:8px;">View Deal at Store</a>`);
  }
  const button = buttons.length > 0 ? `<div style="margin: 24px 0 0;">${buttons.join(' ')}</div>` : '';

  const productLinkNote = productUrl
    ? `<p style="margin: 12px 0 0;color:#6b7280;font-size:12px;word-break:break-all;">Product page: <a href="${productUrl}">${productUrl}</a></p>`
    : '';

  const cartLinkNote = purchaseUrl
    ? `<p style="margin: 8px 0 0;color:#6b7280;font-size:12px;word-break:break-all;">Amazon add-to-cart: <a href="${purchaseUrl}">${purchaseUrl}</a></p>`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;background:#f9fafb;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
        <h2 style="margin:0 0 16px;font-size:20px;">${escapedSubject}</h2>
        <p style="margin:0;font-size:15px;">${escapedMessage}</p>
        ${priceStatsBox}
        ${button}
        ${productLinkNote}
        ${cartLinkNote}
      </div>
    </div>
  `;
}

function buildAlertEmailText(subject, message, purchaseUrl, productUrl, options = {}) {
  const lines = [subject, '', message];

  if (options.currentPrice != null) {
    lines.push('', `Current Price: $${Number(options.currentPrice).toFixed(2)}`);
  }
  if (options.avgPrice30d != null) {
    lines.push(`30-Day Average: $${Number(options.avgPrice30d).toFixed(2)}`);
  }
  if (options.discountPct != null) {
    const diffStr = options.discountPct > 0 ? `${Math.abs(options.discountPct).toFixed(1)}% below 30d avg` : `${Math.abs(options.discountPct).toFixed(1)}% above 30d avg`;
    lines.push(`Difference: ${diffStr}`);
  }

  if (productUrl) {
    lines.push('', `Product page: ${productUrl}`);
  }

  if (purchaseUrl) {
    lines.push('', `Add to Amazon cart: ${purchaseUrl}`);
  }

  return lines.join('\n');
}

async function getSettings() {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM settings WHERE id = 1', (err, row) => {
      if (err) reject(err);
      else resolve(row || {});
    });
  });
}

async function sendAlert(subject, message, options = {}) {
  try {
    const settings = await getSettings();
    if (!settings.globalNotify) {
      log('Global notifications are disabled, skipping alert.');
      return;
    }

    if (isInQuietHours(settings)) {
      log(`Notification suppressed during quiet hours (${settings.quietHoursStart} - ${settings.quietHoursEnd}): ${subject}`);
      return;
    }

    const rawProductUrl = options.productUrl || options.url || null;
    const tag = (settings.amazonAssociateTag || process.env.AMAZON_ASSOCIATE_TAG || process.env.AMAZON_AFFILIATE_TAG || '').trim();
    const affiliateProductUrl = rawProductUrl ? buildAffiliateUrl(rawProductUrl, tag, settings.affiliatePrefix) : null;
    const purchaseUrl = (rawProductUrl ? buildAmazonCartLink(rawProductUrl, tag) : null) || (options.purchaseUrl ? buildAffiliateUrl(options.purchaseUrl, tag, settings.affiliatePrefix) : null);
    const cashback = rawProductUrl ? getCashbackInfo(rawProductUrl) : null;
    const html = buildAlertEmailHtml(subject, message, purchaseUrl, affiliateProductUrl, { ...options, cashback });
    const text = buildAlertEmailText(subject, message, purchaseUrl, affiliateProductUrl, { ...options, cashback });

    // 1. Send Email if configured
    if (settings.gmailUser && settings.gmailAppPassword) {
      try {
        const decryptedPassword = decrypt(settings.gmailAppPassword);
        
        let transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: {
            user: settings.gmailUser,
            pass: decryptedPassword || settings.gmailAppPassword // Fallback if not encrypted yet
          }
        });

        await transporter.sendMail({
          from: `"StockSense" <${settings.gmailUser}>`,
          to: settings.gmailUser,
          subject: subject,
          text,
          html,
        });
        log(`Email alert sent successfully: ${subject}`);
      } catch (err) {
        log(`Failed to send email alert: ${err.message}`, 'ERROR');
      }
    }

    // 2. Send Discord if configured
    if (settings.discordWebhook) {
      try {
        // Mirror the email links and 30d average price stats in Discord
        const embedFields = [];

        if (options.currentPrice != null) {
          embedFields.push({
            name: "Current Price",
            value: `$${Number(options.currentPrice).toFixed(2)}`,
            inline: true
          });
        }

        if (options.avgPrice30d != null) {
          embedFields.push({
            name: "30-Day Avg Price",
            value: `$${Number(options.avgPrice30d).toFixed(2)}`,
            inline: true
          });
        }

        if (options.discountPct != null) {
          const arrow = options.discountPct > 0 ? '▼ ' : '▲ ';
          embedFields.push({
            name: "vs 30d Avg",
            value: `${arrow}${Math.abs(options.discountPct).toFixed(1)}%`,
            inline: true
          });
        }

        if (options.usedPrice != null) {
          embedFields.push({
            name: "Used / Resale",
            value: `$${Number(options.usedPrice).toFixed(2)}${options.usedCondition ? ` (${options.usedCondition})` : ''}`,
            inline: true
          });
        }

        if (affiliateProductUrl) {
          embedFields.push({
            name: "Product Page",
            value: `[View Product Deal](${affiliateProductUrl})`,
            inline: true
          });
        }

        if (purchaseUrl) {
          embedFields.push({
            name: "Amazon Add-to-Cart",
            value: `[Add to cart](${purchaseUrl})`,
            inline: true
          });
        }

        if (cashback) {
          const links = [];
          if (cashback.shopback) links.push(`[ShopBack (${cashback.shopback.rate})](${cashback.shopback.url})`);
          if (cashback.cashrewards) links.push(`[Cashrewards (${cashback.cashrewards.rate})](${cashback.cashrewards.url})`);
          if (links.length > 0) {
            embedFields.push({
              name: "💰 Cashback Available",
              value: links.join(' • '),
              inline: false
            });
          }
        }

        await axios.post(settings.discordWebhook, {
          username: "StockSense",
          avatar_url: "https://cdn-icons-png.flaticon.com/512/3143/3143160.png",
          embeds: [{
            title: subject,
            url: affiliateProductUrl || purchaseUrl || undefined,
            description: message,
            color: (options.discountPct && options.discountPct >= 20) ? 0x10b981 : 0x3b82f6, // Green if sale, blue otherwise
            fields: embedFields
          }]
        });
        log(`Discord alert sent successfully: ${subject}`);
      } catch (err) {
        log(`Failed to send Discord alert: ${err.message}`, 'ERROR');
      }
    }

    // 3. Send Telegram if configured
    if (settings.telegramBotToken && settings.telegramChatId) {
      try {
        let teleText = `*${subject}*\n\n${message}\n`;
        if (options.currentPrice != null) teleText += `• Current Price: $${Number(options.currentPrice).toFixed(2)}\n`;
        if (options.avgPrice30d != null) teleText += `• 30d Average: $${Number(options.avgPrice30d).toFixed(2)}\n`;
        if (options.discountPct != null) teleText += `• vs 30d Avg: ${options.discountPct > 0 ? '▼' : '▲'} ${Math.abs(options.discountPct).toFixed(1)}%\n`;
        if (affiliateProductUrl) teleText += `\n[View Product Deal](${affiliateProductUrl})\n`;
        if (purchaseUrl) teleText += `[Add to Amazon Cart](${purchaseUrl})\n`;
        if (cashback) {
          if (cashback.shopback) teleText += `💰 [ShopBack Cashback (${cashback.shopback.rate})](${cashback.shopback.url})\n`;
          if (cashback.cashrewards) teleText += `💰 [Cashrewards Cashback (${cashback.cashrewards.rate})](${cashback.cashrewards.url})\n`;
        }

        await axios.post(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
          chat_id: settings.telegramChatId,
          text: teleText,
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        });
        log(`Telegram alert sent successfully: ${subject}`);
      } catch (err) {
        log(`Failed to send Telegram alert: ${err.message}`, 'ERROR');
      }
    }

    // 4. Send NTFY if configured
    if (settings.ntfyTopic) {
      try {
        const server = (settings.ntfyServer || 'https://ntfy.sh').replace(/\/+$/, '');
        const ntfyHeaders = {
          'Title': subject,
          'Priority': (options.discountPct && options.discountPct >= 20) ? 'high' : 'default',
          'Tags': 'moneybag,shopping_cart'
        };
        if (affiliateProductUrl || purchaseUrl) ntfyHeaders['Click'] = affiliateProductUrl || purchaseUrl;

        await axios.post(`${server}/${encodeURIComponent(settings.ntfyTopic)}`, text, {
          headers: ntfyHeaders
        });
        log(`NTFY push sent successfully to ${settings.ntfyTopic}`);
      } catch (err) {
        log(`Failed to send NTFY push: ${err.message}`, 'ERROR');
      }
    }
  } catch (err) {
    log(`Notifier error: ${err.message}`, 'ERROR');
  }
}

module.exports = { sendAlert };
