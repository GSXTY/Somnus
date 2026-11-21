import { readFileSync } from 'node:fs';
import { validateDashboard } from '../src/shared/logic.mjs';

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
try {
  const data = validateDashboard(raw, 'live');
  console.log('validate ok | mode:', data.source.mode, '| connected:', data.source.connected);
  console.log('kpis:', Object.fromEntries(Object.entries(data.kpis).map(([key, value]) => [key, value.value])));
  console.log('daily rows:', data.daily.length, '| users:', data.users.length);
} catch (error) {
  console.log('REJECTED:', error.message);
  process.exitCode = 1;
}
