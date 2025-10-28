export type SupplementCard = {
  id: string;
  product_name: string;
  brand: string;
  category: string;
  image_url?: string;
  created_date?: string;
};

export const MOCK_SUPPLEMENTS: SupplementCard[] = [
  { id: '1', product_name: 'Vitamin D3', brand: 'Thorne', category: 'vitamins', image_url: '' },
  { id: '2', product_name: 'Omega-3 Fish Oil', brand: 'Nordic Naturals', category: 'omega3', image_url: '' },
  { id: '3', product_name: 'Magnesium Glycinate', brand: 'KAL', category: 'minerals', image_url: '' },
];
