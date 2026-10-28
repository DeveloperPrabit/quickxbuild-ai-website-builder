import pg from 'pg';

async function main() {
  const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
  await client.connect();
  await client.query(`
    INSERT INTO subscription_limit (id, organization_id, plan_name, plan_id, ai_nums, enhance_nums, upload_limit, deploy_limit, seats, project_nums, is_active, period_start, period_end, billing_interval)
    VALUES ('limit_dkoh2c', 'dkoh2c4phmak1jt19i727k9w', 'quickxbuild enterprise', 'plan_enterprise', 99999, 99999, 99999, 199998, 99999, 99997, true, NOW(), NOW() + interval '1 year', 'year')
    ON CONFLICT DO NOTHING;
  `);
  await client.query(`
    INSERT INTO workspace_billing (organization_id, credits_balance, subscription_tier, workspace_type, version)
    VALUES ('dkoh2c4phmak1jt19i727k9w', 999999, 'ADVANCED', 'TEAM', 1)
    ON CONFLICT (organization_id) DO UPDATE SET credits_balance = 999999, subscription_tier = 'ADVANCED';
  `);
  console.log('Postgres enterprise granted to dkoh2c4phmak1jt19i727k9w');
  await client.end();
}

main().catch(console.error);
