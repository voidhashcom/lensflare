import { ValidationError } from "@lensflare/contracts";
import { Effect } from "effect";
import { slugify } from "../domain/slug.ts";

export type ValidationField = "projectName" | "datasetName" | "projectSlug" | "datasetSlug";

/**
 * Trim a required name and reject empty strings with a {@link ValidationError}
 * tagged with the originating field. Accepting a `field` discriminator keeps
 * the same error semantics for project and dataset operations.
 */
export const normalizeRequiredName = (field: ValidationField, value: string) =>
  Effect.suspend(() => {
    const trimmed = value.trim();
    return trimmed.length > 0
      ? Effect.succeed(trimmed)
      : Effect.fail(
          new ValidationError({
            field,
            message: "Name must not be empty.",
          }),
        );
  });

/**
 * Variant for partial updates: `undefined` means "leave the existing value
 * alone" and short-circuits to {@link Effect.void}. A provided value is run
 * through {@link normalizeRequiredName}.
 */
export const normalizeOptionalName = (field: ValidationField, value: string | undefined) =>
  value === undefined ? Effect.succeed(undefined) : normalizeRequiredName(field, value);

function validateSlugCharacters(field: ValidationField, value: string) {
  const trimmed = value.trim();
  const normalized = slugify(trimmed);

  if (trimmed.length === 0) {
    return Effect.fail(
      new ValidationError({
        field,
        message: "Slug must not be empty.",
      }),
    );
  }

  if (trimmed !== normalized) {
    return Effect.fail(
      new ValidationError({
        field,
        message: "Slug must use lowercase letters, numbers, and hyphens only.",
      }),
    );
  }

  return Effect.succeed(normalized);
}

export const normalizeSlug = (field: ValidationField, value: string) =>
  Effect.suspend(() => validateSlugCharacters(field, value));

export const normalizeOptionalSlug = (field: ValidationField, value: string | undefined) =>
  value === undefined ? Effect.succeed(undefined) : normalizeSlug(field, value);
