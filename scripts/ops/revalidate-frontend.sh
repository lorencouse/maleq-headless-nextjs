#!/usr/bin/env bash
# Force the Next.js frontend to drop its product caches (in-memory product index,
# /shop, every /product/<slug>, category/brand/attribute tags).
#
# Runs ON the WordPress host, where MALEQ_FRONTEND_URL and
# MALEQ_REVALIDATION_SECRET live in wp-config.php — the secret never leaves the box:
#
#   ssh root@159.69.220.162 'bash -s' < scripts/ops/revalidate-frontend.sh
#
# Use after bulk changes made outside the WP admin (wp-cli / SQL), because the
# save_post webhooks fired from a CLI process are non-blocking and are dropped
# when the PHP process exits.
set -u
SITE=/home/maleq-wp/htdocs/wp.maleq.com
su - maleq-wp -s /bin/bash -c "cd $SITE && wp eval '
  \$r = wp_remote_post(MALEQ_FRONTEND_URL . \"/api/revalidate\", [
    \"headers\"  => [\"Content-Type\" => \"application/json\", \"x-revalidation-secret\" => MALEQ_REVALIDATION_SECRET],
    \"body\"     => wp_json_encode([\"type\" => \"all\"]),
    \"timeout\"  => 60,
    \"blocking\" => true,
  ]);
  echo is_wp_error(\$r) ? \"ERROR: \" . \$r->get_error_message() : wp_remote_retrieve_response_code(\$r) . \" \" . wp_remote_retrieve_body(\$r), PHP_EOL;
'"
