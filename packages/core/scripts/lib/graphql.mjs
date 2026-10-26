// GraphQL: the introspection query (sent over GET only -- GraphQL-over-HTTP forbids mutations over GET, so the probe
// can never change data) and its result -> one operation per root field.
//
//   operationsFromIntrospection(result) -> [{operationType: query|mutation|subscription, field, args[], returnType}]

export const INTROSPECTION_QUERY =
  "query ATFIntrospection{__schema{queryType{name}mutationType{name}subscriptionType{name}" +
  "types{kind name fields(includeDeprecated:true){name isDeprecated args{name type{...T}}type{...T}}}}}" +
  "fragment T on __Type{kind name ofType{kind name ofType{kind name ofType{kind name}}}}";

// NON_NULL/LIST wrappers -> "String!", "[Contact!]!"
export function typeName(t) {
  if (!t) return "unknown";
  if (t.kind === "NON_NULL") return `${typeName(t.ofType)}!`;
  if (t.kind === "LIST") return `[${typeName(t.ofType)}]`;
  return t.name ?? "unknown";
}

export function operationsFromIntrospection(result) {
  const schema = result?.data?.__schema ?? result?.__schema;
  if (!schema?.types) throw new Error("not a GraphQL introspection result (no __schema.types)");
  const byName = new Map(schema.types.map((t) => [t.name, t]));
  const out = [];
  for (const [operationType, root] of [["query", schema.queryType], ["mutation", schema.mutationType], ["subscription", schema.subscriptionType]]) {
    const type = root?.name && byName.get(root.name);
    for (const f of type?.fields ?? [])
      out.push({
        operationType,
        field: f.name,
        args: (f.args ?? []).map((a) => ({ name: a.name, type: typeName(a.type), required: a.type?.kind === "NON_NULL" })),
        returnType: typeName(f.type),
        deprecated: !!f.isDeprecated,
      });
  }
  return out.sort((a, b) => a.operationType.localeCompare(b.operationType) || a.field.localeCompare(b.field));
}
