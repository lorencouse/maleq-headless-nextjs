<?php
/**
 * Test harness: loads maleq-restricted-products-guard.php outside WordPress and runs
 * maleq_rpg_check() over JSON cases from stdin. Used by
 * __tests__/lib/restricted-rules-sync.test.ts to prove the PHP port and the TypeScript
 * checker agree.
 *
 *   php harness.php /path/to/maleq-restricted-products-guard.php < cases.json
 *   → {"results":[category|null, ...], "errors":[...]}
 */
define('ABSPATH', '/');
function add_filter() {}
function add_action() {}

$errors = [];
set_error_handler(static function ($no, $str) use (&$errors) {
    $errors[] = $str;
    return true;
});

require $argv[1];

$cfg = maleq_rpg_config();
if ($cfg === null) {
    fwrite(STDERR, "rules JSON not loadable\n");
    exit(2);
}

// Compile every pattern once so a PCRE-incompatible rule fails loudly, not silently.
foreach (array_merge($cfg['negatedClaims'], array_column($cfg['rules'], 'pattern'), array_filter(array_column($cfg['rules'], 'unless'))) as $r) {
    if (@preg_match(maleq_rpg_re($r), '') === false) {
        $errors[] = 'pattern does not compile in PCRE: ' . $r['source'] . ' (' . preg_last_error_msg() . ')';
    }
}

$cases   = json_decode(stream_get_contents(STDIN), true) ?: [];
$results = [];
foreach ($cases as $c) {
    $r         = maleq_rpg_check($c, $cfg);
    $results[] = $r ? $r['category'] : null;
}

echo json_encode(['results' => $results, 'errors' => $errors]);
