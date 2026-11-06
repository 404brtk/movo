import { Effect, Schema, Struct } from "effect";

interface UndefinedWhenInvalid extends Struct.Lambda {
  <S extends Schema.Top>(schema: S): Schema.middlewareDecoding<S, S["DecodingServices"]>;
  readonly "~lambda.out": this["~lambda.in"] extends Schema.Top
    ? Schema.middlewareDecoding<this["~lambda.in"], this["~lambda.in"]["DecodingServices"]>
    : never;
}

const undefinedWhenInvalid = Struct.lambda<UndefinedWhenInvalid>((schema) =>
  schema.pipe(Schema.catchDecoding(() => Effect.succeedSome(undefined))),
);

export const searchParams = <
  Fields extends Readonly<Record<string, Schema.Top & { readonly DecodingServices: never }>>,
>(
  schema: Schema.Struct<Fields>,
) => Schema.toStandardSchemaV1(schema.mapFields(Struct.map(undefinedWhenInvalid)));
