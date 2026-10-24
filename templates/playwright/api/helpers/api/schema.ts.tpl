// JSON-schema validation for API responses (the schemas in config/api/schemas/). Pure: no request context, no
// assertions; the test asserts on the result.
import Ajv, { type ErrorObject } from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

export type SchemaResult = { valid: boolean; errors: string[] };

export function validateSchema(schema: object, body: unknown): SchemaResult {
  const validate = ajv.compile(schema);
  const valid = Boolean(validate(body));
  const errors = (validate.errors ?? []).map((e: ErrorObject) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
  return { valid, errors };
}
