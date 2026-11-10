import { useCallback, useEffect, useState } from 'react';
import type { ApiRequest, RequestCollection, RequestMeta, RequestTag } from '../types';
import { loadStored, saveStored } from '../utils/storage';

const MAX_FAVORITES = 200; // prevents unbounded growth

function withoutCollection(meta: RequestMeta): RequestMeta {
  const { collectionId: _removed, ...rest } = meta;
  return rest as RequestMeta;
}

/** Collections, tags, pins and favourites: everything the user attaches to requests. */
export function useCollections() {
  const [collections, setCollections] = useState<RequestCollection[]>([]);
  const [tags, setTags] = useState<RequestTag[]>([]);
  const [requestMeta, setRequestMeta] = useState<Record<string, RequestMeta>>({});
  const [favorites, setFavorites] = useState<string[]>([]); // request ids

  useEffect(() => {
    void loadStored(['collections', 'tags', 'requestMeta', 'favorites']).then((stored) => {
      // Collections saved by old versions have no `requests` field.
      if (stored.collections) setCollections(stored.collections.map((collection) => ({ ...collection, requests: collection.requests || [] })));
      if (stored.tags) setTags(stored.tags);
      if (stored.requestMeta) setRequestMeta(stored.requestMeta);
      if (stored.favorites) setFavorites(stored.favorites);
    });
  }, []);

  const toggleFavorite = useCallback((requestId: string) => {
    setFavorites((previous) => {
      const next = previous.includes(requestId)
        ? previous.filter((id) => id !== requestId)
        : [...previous, requestId].slice(-MAX_FAVORITES);
      saveStored({ favorites: next });
      return next;
    });
  }, []);

  const createCollection = useCallback((name: string, description?: string, color?: string) => {
    const now = Date.now();
    const updated: RequestCollection[] = [
      ...collections,
      { id: crypto.randomUUID(), name, description: description || '', color: color || '#2563EB', requestIds: [], requests: [], createdAt: now, updatedAt: now },
    ];
    setCollections(updated);
    saveStored({ collections: updated });
  }, [collections]);

  const deleteCollection = useCallback((collectionId: string) => {
    const updated = collections.filter((collection) => collection.id !== collectionId);
    const newMeta = { ...requestMeta };
    for (const id of Object.keys(newMeta)) {
      if (newMeta[id].collectionId === collectionId) newMeta[id] = withoutCollection(newMeta[id]);
    }
    setCollections(updated);
    setRequestMeta(newMeta);
    saveStored({ collections: updated, requestMeta: newMeta });
  }, [collections, requestMeta]);

  const addToCollection = useCallback((collectionId: string, requestIds: string[], requests: ApiRequest[] = []) => {
    const updated = collections.map((collection) => {
      if (collection.id !== collectionId) return collection;
      const existingIds = new Set(collection.requests.map((request) => request.id));
      return {
        ...collection,
        requestIds: [...new Set([...collection.requestIds, ...requestIds])],
        requests: [...collection.requests, ...requests.filter((request) => !existingIds.has(request.id))],
        updatedAt: Date.now(),
      };
    });
    const newMeta = { ...requestMeta };
    for (const id of requestIds) newMeta[id] = { ...(newMeta[id] || {}), collectionId } as RequestMeta;
    setCollections(updated);
    setRequestMeta(newMeta);
    saveStored({ collections: updated, requestMeta: newMeta });
  }, [collections, requestMeta]);

  const addRequestToCollection = useCallback((collectionId: string, request: ApiRequest) => {
    addToCollection(collectionId, [request.id], [request]);
  }, [addToCollection]);

  const removeFromCollection = useCallback((collectionId: string, requestId: string) => {
    const updated = collections.map((collection) => {
      if (collection.id !== collectionId) return collection;
      return {
        ...collection,
        requestIds: collection.requestIds.filter((id) => id !== requestId),
        requests: collection.requests.filter((request) => request.id !== requestId),
        updatedAt: Date.now(),
      };
    });
    const newMeta = { ...requestMeta };
    if (newMeta[requestId]?.collectionId === collectionId) newMeta[requestId] = withoutCollection(newMeta[requestId]);
    setCollections(updated);
    setRequestMeta(newMeta);
    saveStored({ collections: updated, requestMeta: newMeta });
  }, [collections, requestMeta]);

  const createTag = useCallback((name: string, color: string) => {
    const updated = [...tags, { id: crypto.randomUUID(), name, color }];
    setTags(updated);
    saveStored({ tags: updated });
  }, [tags]);

  const deleteTag = useCallback((tagId: string) => {
    const updated = tags.filter((tag) => tag.id !== tagId);
    const newMeta = { ...requestMeta };
    for (const id of Object.keys(newMeta)) {
      const assigned = newMeta[id]?.tags;
      if (assigned?.includes(tagId)) newMeta[id] = { ...newMeta[id], tags: assigned.filter((tag) => tag !== tagId) };
    }
    setTags(updated);
    setRequestMeta(newMeta);
    saveStored({ tags: updated, requestMeta: newMeta });
  }, [tags, requestMeta]);

  const togglePin = useCallback((requestId: string) => {
    const current = requestMeta[requestId] || ({} as RequestMeta);
    const newMeta = { ...requestMeta, [requestId]: { ...current, pinned: !current.pinned } };
    setRequestMeta(newMeta);
    saveStored({ requestMeta: newMeta });
  }, [requestMeta]);

  return {
    collections,
    tags,
    requestMeta,
    favorites,
    toggleFavorite,
    createCollection,
    deleteCollection,
    addToCollection,
    addRequestToCollection,
    removeFromCollection,
    createTag,
    deleteTag,
    togglePin,
  };
}
