import { Schema } from "effect";

export class UnknownProjectSlug extends Schema.TaggedErrorClass<UnknownProjectSlug>()(
  "UnknownProjectSlug",
  {
    projectSlug: Schema.String,
  },
) {}

export class UnknownDatasetSlug extends Schema.TaggedErrorClass<UnknownDatasetSlug>()(
  "UnknownDatasetSlug",
  {
    datasetSlug: Schema.String,
  },
) {}

export class ProjectDatasetMismatch extends Schema.TaggedErrorClass<ProjectDatasetMismatch>()(
  "ProjectDatasetMismatch",
  {
    projectSlug: Schema.String,
    datasetSlug: Schema.String,
  },
) {}

export class UnsupportedContentType extends Schema.TaggedErrorClass<UnsupportedContentType>()(
  "UnsupportedContentType",
  {
    provider: Schema.String,
    contentType: Schema.String,
  },
) {}

export class UnsupportedContentEncoding extends Schema.TaggedErrorClass<UnsupportedContentEncoding>()(
  "UnsupportedContentEncoding",
  {
    provider: Schema.String,
    contentEncoding: Schema.String,
  },
) {}

export class MalformedPayload extends Schema.TaggedErrorClass<MalformedPayload>()(
  "MalformedPayload",
  {
    provider: Schema.String,
    message: Schema.String,
  },
) {}

export class NormalizationFailure extends Schema.TaggedErrorClass<NormalizationFailure>()(
  "NormalizationFailure",
  {
    provider: Schema.String,
    message: Schema.String,
  },
) {}
