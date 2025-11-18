import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Search as SearchIcon } from 'lucide-react-native';
import { router, type Href } from 'expo-router';

import { ResponsiveHeader } from '@/components/common/ResponsiveHeader';
import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

type SupplementRow = Database['public']['Tables']['supplements']['Row'];
type BrandRow = Database['public']['Tables']['brands']['Row'];
type SearchResult = SupplementRow & { brands?: BrandRow | null };

const categoryEmojis: Record<string, string> = {
  vitamins: '💊',
  minerals: '⚡',
  probiotics: '🦠',
  omega3: '🐟',
  herbs: '🌿',
  amino_acids: '🧬',
  other: '📦',
};

const toSearchPattern = (query: string) => {
  const trimmed = query.trim().replace(/[%]/g, '');
  const collapsed = trimmed.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return '%';
  }
  return `%${collapsed.replace(/\s+/g, '%')}%`;
};

const fetchBrandIds = async (pattern: string) => {
  const { data, error } = await supabase
    .from('brands')
    .select('id')
    .ilike('name', pattern)
    .limit(8);

  if (error) {
    console.warn('[search] brand lookup failed', error);
    return [];
  }

  return (data ?? []).map(item => item.id);
};

const searchSupplements = async (pattern: string, brandIds: string[]) => {
  const orFilters = [
    `name.ilike.${pattern}`,
    `barcode.ilike.${pattern}`,
    `category.ilike.${pattern}`,
    `description.ilike.${pattern}`,
  ];

  if (brandIds.length > 0) {
    const encoded = brandIds.map(id => `"${id}"`).join(',');
    orFilters.push(`brand_id.in.(${encoded})`);
  }

  const { data, error } = await supabase
    .from('supplements')
    .select('*, brands(*)')
    .or(orFilters.join(','))
    .order('verified', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) {
    throw error;
  }

  return (data ?? []) as SearchResult[];
};

export default function SearchPage() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const term = searchQuery.trim();
    if (!term) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const pattern = toSearchPattern(term);
    let cancelled = false;
    setIsSearching(true);
    setSearchError(null);

    const handler = setTimeout(async () => {
      try {
        const brandIds = await fetchBrandIds(pattern);
        const supplements = await searchSupplements(pattern, brandIds);
        if (!cancelled) {
          setResults(supplements);
        }
      } catch (error) {
        console.warn('[search] fetch failed', error);
        if (!cancelled) {
          setSearchError('Search failed. Please try again.');
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handler);
    };
  }, [searchQuery]);

  const hasQuery = searchQuery.trim().length > 0;
  const hasResults = results.length > 0;

  return (
    <ResponsiveScreen contentStyle={styles.screen}>
      <ResponsiveHeader title="Search" subtitle="Find your supplements" onBack={() => router.replace('/main')} />

      <View style={styles.searchFieldWrapper}>
        <SearchIcon size={tokens.components.iconButton.iconSize} color={tokens.colors.textMuted} style={styles.searchIcon} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by name, brand, or ingredient..."
          placeholderTextColor={tokens.colors.textMuted}
          style={styles.searchInput}
        />
      </View>

      {!hasQuery ? (
        <View style={styles.emptyCard}>
          <View style={[styles.emptyIcon, styles.emptyIconActive]}>
            <SearchIcon size={Math.round(tokens.components.iconButton.iconSize * 1.8)} color={tokens.colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>Search Your Supplements</Text>
          <Text style={styles.emptySubtitle}>Start typing to find supplements by name, brand, or ingredient</Text>
        </View>
      ) : isSearching ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator color={tokens.colors.accent} />
          <Text style={styles.emptySubtitle}>Searching database…</Text>
        </View>
      ) : searchError ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <SearchIcon size={Math.round(tokens.components.iconButton.iconSize * 1.8)} color={tokens.colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Something went wrong</Text>
          <Text style={styles.emptySubtitle}>{searchError}</Text>
        </View>
      ) : !hasResults ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <SearchIcon size={Math.round(tokens.components.iconButton.iconSize * 1.8)} color={tokens.colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No results found</Text>
          <Text style={styles.emptySubtitle}>Try searching with different keywords</Text>
        </View>
      ) : (
        <ScrollView style={styles.resultsScroller} contentContainerStyle={styles.resultsContent} keyboardShouldPersistTaps="handled">
          {results.map(supplement => (
            <TouchableOpacity
              key={supplement.id}
              activeOpacity={0.9}
              onPress={() => {
                if (!supplement.id) {
                  return;
                }
                router.push(`/supplement?id=${supplement.id}` as Href);
              }}
            >
              <View style={styles.resultCard}>
                <View style={styles.resultThumb}>
                  {supplement.image_url ? (
                    <Image source={{ uri: supplement.image_url }} style={styles.resultThumbImage} />
                  ) : (
                    <Text style={styles.resultThumbEmoji}>{categoryEmojis[supplement.category ?? ''] ?? '📦'}</Text>
                  )}
                </View>
                <View style={styles.resultBody}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {supplement.name}
                  </Text>
                  <Text style={styles.resultSubtitle} numberOfLines={1}>
                    {supplement.brands?.name ?? 'Unknown brand'}
                  </Text>
                  {supplement.created_at ? (
                    <Text style={styles.resultMeta}>
                      {new Date(supplement.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.resultPill}>
                  <Text style={styles.resultPillText}>{(supplement.category || '').replace(/_/g, ' ')}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </ResponsiveScreen>
  );
}

const createStyles = (tokens: DesignTokens) =>
  StyleSheet.create({
    screen: {
      paddingVertical: tokens.spacing.xl,
      gap: tokens.spacing.lg,
    },
    searchFieldWrapper: {
      position: 'relative',
    },
    searchIcon: {
      position: 'absolute',
      left: tokens.spacing.md,
      top: '50%',
      marginTop: -tokens.components.iconButton.iconSize / 2,
    },
    searchInput: {
      height: Math.round(tokens.components.iconButton.size * 1.6),
      borderRadius: tokens.radius['2xl'],
      borderWidth: 1,
      borderColor: tokens.colors.border,
      backgroundColor: tokens.colors.surface,
      paddingLeft: Math.round(tokens.spacing.lg * 1.5),
      paddingRight: tokens.spacing.md,
      color: tokens.colors.textPrimary,
      ...tokens.typography.body,
    },
    emptyCard: {
      alignItems: 'center',
      backgroundColor: tokens.colors.surface,
      borderRadius: tokens.radius['2xl'],
      paddingHorizontal: tokens.components.card.paddingHorizontal,
      paddingVertical: Math.round(tokens.components.card.paddingVertical * 1.4),
      gap: tokens.spacing.md,
      ...tokens.shadow.card,
    },
    emptyIcon: {
      width: Math.round(tokens.components.iconButton.size * 2.2),
      height: Math.round(tokens.components.iconButton.size * 2.2),
      borderRadius: tokens.radius['2xl'],
      backgroundColor: tokens.colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyIconActive: {
      backgroundColor: tokens.colors.accentSoft,
    },
    emptyTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.subtitle,
    },
    emptySubtitle: {
      color: tokens.colors.textMuted,
      textAlign: 'center',
      ...tokens.typography.body,
    },
    resultsScroller: {
      flex: 1,
      width: '100%',
      backgroundColor: tokens.colors.background,
    },
    resultsContent: {
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    resultCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.sm,
      backgroundColor: tokens.colors.surface,
      borderRadius: tokens.radius['2xl'],
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      ...tokens.shadow.lifted,
    },
    resultThumb: {
      width: Math.round(tokens.components.iconButton.size * 1.4),
      height: Math.round(tokens.components.iconButton.size * 1.4),
      borderRadius: tokens.radius.lg,
      backgroundColor: tokens.colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resultThumbImage: {
      width: '100%',
      height: '100%',
      borderRadius: tokens.radius.lg,
    },
    resultThumbEmoji: {
      fontSize: Math.round(tokens.typography.title.fontSize * 1.1),
    },
    resultBody: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    resultTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.body,
      fontWeight: '700',
    },
    resultSubtitle: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    resultMeta: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    resultPill: {
      borderRadius: tokens.radius.full,
      backgroundColor: tokens.colors.surfaceMuted,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: Math.max(6, tokens.spacing.xs),
    },
    resultPillText: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
  });
