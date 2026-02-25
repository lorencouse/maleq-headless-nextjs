/**
 * One-time migration: Create push notification tables.
 *
 * Usage:
 *   bun scripts/setup-push-tables.ts          # local DB
 *   bun scripts/setup-push-tables.ts --remote  # production (via SSH tunnel)
 */
import { getConnection } from './lib/db';

async function main() {
  const db = await getConnection();

  console.log('Creating maleq_push_subscriptions table...');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS maleq_push_subscriptions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      endpoint VARCHAR(1000) NOT NULL,
      p256dh VARCHAR(200) NOT NULL,
      auth VARCHAR(100) NOT NULL,
      customer_id BIGINT UNSIGNED DEFAULT NULL,
      email VARCHAR(255) DEFAULT NULL,
      pref_order_updates TINYINT(1) NOT NULL DEFAULT 1,
      pref_back_in_stock TINYINT(1) NOT NULL DEFAULT 1,
      pref_promotions TINYINT(1) NOT NULL DEFAULT 1,
      user_agent VARCHAR(500) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_endpoint (endpoint),
      KEY idx_customer_id (customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  ✅ maleq_push_subscriptions created');

  console.log('Creating maleq_stock_alert_products table...');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS maleq_stock_alert_products (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      subscription_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      product_slug VARCHAR(255) NOT NULL,
      notified_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sub_product (subscription_id, product_id),
      KEY idx_product_id (product_id),
      CONSTRAINT fk_stock_alert_subscription
        FOREIGN KEY (subscription_id) REFERENCES maleq_push_subscriptions(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  ✅ maleq_stock_alert_products created');

  console.log('Creating maleq_stock_alert_email_subscriptions table...');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS maleq_stock_alert_email_subscriptions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      product_slug VARCHAR(255) NOT NULL,
      notified_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_email_product (email, product_id),
      KEY idx_product_notified (product_id, notified_at),
      KEY idx_notified (notified_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  ✅ maleq_stock_alert_email_subscriptions created');

  console.log('Creating maleq_push_notification_history table...');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS maleq_push_notification_history (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      subscription_id BIGINT UNSIGNED NULL,
      customer_id BIGINT UNSIGNED NULL,
      push_type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      body VARCHAR(500) NOT NULL,
      url VARCHAR(2048) NULL,
      image VARCHAR(2048) NULL,
      tag VARCHAR(255) NULL,
      product_id BIGINT UNSIGNED NULL,
      order_id BIGINT UNSIGNED NULL,
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_customer_sent (customer_id, sent_at),
      KEY idx_subscription_sent (subscription_id, sent_at),
      KEY idx_type_sent (push_type, sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  ✅ maleq_push_notification_history created');

  console.log('\nDone! Push notification tables are ready.');
  await db.end();
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
