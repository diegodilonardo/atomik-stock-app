const test = require('node:test');
const assert = require('node:assert/strict');
const { localClock, validateSchedule } = require('../src/services/grid-scheduler');
test('horarios de exportacion en Argentina y validacion de destino', () => {
  assert.deepEqual(localClock(new Date('2026-09-22T02:30:00Z')), { date: '2026-09-21', time: '23:30' });
  assert.deepEqual(validateSchedule({ enabled: false }), { enabled: false, time: null, path: null });
  assert.equal(validateSchedule({ enabled: true, time: '07:00', path: 'C:\\Grillas\\diaria.xlsx' }).time, '07:00');
  for (const body of [{ enabled: 'true' }, { enabled: true, time: '24:00' }, { enabled: true, time: '08:00', path: 'relativa.xlsx' }, { enabled: true, time: '08:00', path: 'C:\\Grillas\\archivo.txt' }]) {
    assert.throws(() => validateSchedule(body), { status: 400 });
  }
});
