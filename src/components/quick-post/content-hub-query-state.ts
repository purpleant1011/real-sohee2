import { parseAsString, parseAsStringEnum, createSerializer } from 'nuqs'

export const contentHubQueryParsers = {
  status: parseAsStringEnum(['waiting', 'published', 'all']).withDefault('waiting'),
  channel: parseAsStringEnum(['instagram', 'threads', 'all']).withDefault('all'),
  q: parseAsString.withDefault(''),
  cursor: parseAsString.withDefault(''),
  post: parseAsString.withDefault(''),
  // Unrelated deep links to preserve
  studio: parseAsString.withDefault(''),
  panel: parseAsString.withDefault(''),
  compose: parseAsString.withDefault(''),
}

export const serializeContentHubQuery = createSerializer(contentHubQueryParsers)
