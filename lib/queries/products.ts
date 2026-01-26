import { gql } from '@apollo/client';

// Fragment for product fields
export const PRODUCT_FIELDS = gql`
  fragment ProductFields on Product {
    id
    databaseId
    name
    slug
    shortDescription
    sku
    averageRating
    reviewCount
    type
    image {
      id
      sourceUrl
      altText
      mediaDetails {
        width
        height
      }
    }
    productCategories {
      nodes {
        id
        name
        slug
      }
    }
    productTags {
      nodes {
        id
        name
        slug
      }
    }
    productBrands {
      nodes {
        id
        name
        slug
      }
    }
    productMaterials {
      nodes {
        id
        name
        slug
      }
    }
    ... on SimpleProduct {
      price
      regularPrice
      salePrice
      onSale
      stockStatus
      stockQuantity
      attributes {
        nodes {
          id
          name
          options
          variation
          visible
        }
      }
    }
    ... on VariableProduct {
      price
      regularPrice
      salePrice
      onSale
      stockStatus
      stockQuantity
      attributes {
        nodes {
          id
          name
          options
          variation
          visible
        }
      }
    }
    ... on ExternalProduct {
      price
      regularPrice
      salePrice
      onSale
      attributes {
        nodes {
          id
          name
          options
          variation
          visible
        }
      }
    }
    ... on GroupProduct {
      price
    }
  }
`;

// Get all products with pagination
export const GET_ALL_PRODUCTS = gql`
  ${PRODUCT_FIELDS}
  query GetAllProducts($first: Int = 12, $after: String) {
    products(
      first: $first
      after: $after
      where: { orderby: { field: DATE, order: DESC } }
    ) {
      nodes {
        ...ProductFields
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

// Get single product by slug
export const GET_PRODUCT_BY_SLUG = gql`
  ${PRODUCT_FIELDS}
  query GetProductBySlug($slug: ID!) {
    product(id: $slug, idType: SLUG) {
      ...ProductFields
      description
      featured
      purchaseNote
      galleryImages {
        nodes {
          id
          sourceUrl
          altText
          mediaDetails {
            width
            height
          }
        }
      }
      productBrands {
        nodes {
          id
          name
          slug
        }
      }
      ... on SimpleProduct {
        weight
        length
        width
        height
        attributes {
          nodes {
            id
            name
            options
            variation
            visible
          }
        }
      }
      ... on VariableProduct {
        weight
        length
        width
        height
        attributes {
          nodes {
            id
            name
            options
            variation
            visible
          }
        }
        variations {
          nodes {
            id
            databaseId
            name
            sku
            description
            price
            regularPrice
            salePrice
            stockStatus
            stockQuantity
            weight
            length
            width
            height
            image {
              id
              sourceUrl
              altText
            }
            attributes {
              nodes {
                name
                value
              }
            }
          }
        }
      }
      ... on ExternalProduct {
        attributes {
          nodes {
            id
            name
            options
            variation
            visible
          }
        }
        externalUrl
        buttonText
      }
    }
  }
`;

// Get products by category
export const GET_PRODUCTS_BY_CATEGORY = gql`
  ${PRODUCT_FIELDS}
  query GetProductsByCategory(
    $category: String!
    $first: Int = 12
    $after: String
  ) {
    products(
      first: $first
      after: $after
      where: { category: $category, orderby: { field: DATE, order: DESC } }
    ) {
      nodes {
        ...ProductFields
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

// Search products (searches title, description, etc.)
export const SEARCH_PRODUCTS = gql`
  ${PRODUCT_FIELDS}
  query SearchProducts($search: String!, $first: Int = 12, $after: String) {
    products(
      first: $first
      after: $after
      where: { search: $search, orderby: { field: DATE, order: DESC } }
    ) {
      nodes {
        ...ProductFields
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

// Search products by title/name only (more relevant results)
export const SEARCH_PRODUCTS_BY_TITLE = gql`
  ${PRODUCT_FIELDS}
  query SearchProductsByTitle($titleSearch: String!, $first: Int = 12, $after: String) {
    products(
      first: $first
      after: $after
      where: { titleSearch: $titleSearch, orderby: { field: DATE, order: DESC } }
    ) {
      nodes {
        ...ProductFields
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

// Get all product slugs for static generation
export const GET_ALL_PRODUCT_SLUGS = gql`
  query GetAllProductSlugs {
    products(first: 10000) {
      nodes {
        slug
      }
    }
  }
`;

// Get all product categories (with pagination support)
// Note: hideEmpty filter has a bug in WPGraphQL that limits results to 100
// So we fetch all and filter client-side
export const GET_ALL_PRODUCT_CATEGORIES = gql`
  query GetAllProductCategories($first: Int = 100, $after: String) {
    productCategories(first: $first, after: $after) {
      nodes {
        id
        name
        slug
        count
        description
        image {
          sourceUrl
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Get hierarchical product categories (top-level with nested children)
export const GET_HIERARCHICAL_CATEGORIES = gql`
  query GetHierarchicalCategories {
    productCategories(first: 100, where: { parent: 0 }) {
      nodes {
        id
        name
        slug
        count
        children(first: 50) {
          nodes {
            id
            name
            slug
            count
            children(first: 50) {
              nodes {
                id
                name
                slug
                count
                children(first: 50) {
                  nodes {
                    id
                    name
                    slug
                    count
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Get all product brands (simple query without pagination for smaller datasets)
export const GET_ALL_BRANDS = gql`
  query GetAllBrands {
    productBrands(first: 1000, where: { hideEmpty: true }) {
      nodes {
        id
        name
        slug
        count
      }
    }
  }
`;

// Get product brands with pagination (for large datasets)
export const GET_BRANDS_PAGE = gql`
  query GetBrandsPage($first: Int!, $after: String) {
    productBrands(first: $first, after: $after, where: { hideEmpty: true }) {
      nodes {
        id
        name
        slug
        count
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Get a single brand by slug
export const GET_BRAND_BY_SLUG = gql`
  query GetBrandBySlug($slug: ID!) {
    productBrand(id: $slug, idType: SLUG) {
      id
      name
      slug
      count
      description
    }
  }
`;

// Get all product materials
export const GET_ALL_MATERIALS = gql`
  query GetAllMaterials {
    productMaterials(first: 500, where: { hideEmpty: true }) {
      nodes {
        id
        name
        slug
        count
      }
    }
  }
`;

// Get all product attributes (global attributes like color)
// Note: Material is now a custom taxonomy (product_material), not a product attribute
export const GET_GLOBAL_ATTRIBUTES = gql`
  query GetGlobalAttributes {
    allPaColor(first: 100) {
      nodes {
        id
        name
        slug
        count
      }
    }
  }
`;

// Filter products with multiple criteria including taxonomy filters
export const FILTER_PRODUCTS = gql`
  ${PRODUCT_FIELDS}
  query FilterProducts(
    $first: Int = 12
    $after: String
    $category: String
    $minPrice: Float
    $maxPrice: Float
    $onSale: Boolean
    $stockStatus: [StockStatusEnum]
    $taxonomyFilter: ProductTaxonomyInput
  ) {
    products(
      first: $first
      after: $after
      where: {
        category: $category
        minPrice: $minPrice
        maxPrice: $maxPrice
        onSale: $onSale
        stockStatus: $stockStatus
        taxonomyFilter: $taxonomyFilter
        orderby: { field: DATE, order: DESC }
      }
    ) {
      nodes {
        ...ProductFields
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

// Search products by category slug (for category-based search results)
export const SEARCH_PRODUCTS_BY_CATEGORY = gql`
  ${PRODUCT_FIELDS}
  query SearchProductsByCategory($category: String!, $first: Int = 200) {
    products(
      first: $first
      where: { category: $category, orderby: { field: DATE, order: DESC } }
    ) {
      nodes {
        ...ProductFields
      }
    }
  }
`;
