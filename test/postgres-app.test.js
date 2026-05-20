'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { replaceQuestionPlaceholders } = require('../lib/db/postgres-app');

test('PostgreSQL app adapter converts question placeholders outside strings', () => {
  const sql = replaceQuestionPlaceholders(
    "SELECT * FROM projects WHERE id = ? AND project_name <> '?' AND company_id = ?"
  );

  assert.equal(sql, "SELECT * FROM projects WHERE id = $1 AND project_name <> '?' AND company_id = $2");
});
