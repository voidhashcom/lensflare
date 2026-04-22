import { ValidationError } from "@lensflare/contracts";
import { Effect } from "effect";

export type NameField = "projectName" | "datasetName";

/**
 * Trim a required name and reject empty strings with a {@link ValidationError}
 * tagged with the originating field. Accepting a `field` discriminator keeps
 * the same error semantics for project and dataset operations.
 */
export const normalizeRequiredName = (field: NameField, value: string) =>
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
export const normalizeOptionalName = (field: NameField, value: string | undefined) =>
  value === undefined ? Effect.void : normalizeRequiredName(field, value);
