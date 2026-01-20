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
    ... on SimpleProduct {
      price
      regularPrice
      salePrice
      onSale
      stockStatus
      stockQuantity
    }
    ... on VariableProduct {
      price
      regularPrice
      salePrice
      onSale
      stockStatus
      stockQuantity
    }
    ... on ExternalProduct {
      price
      regularPrice
      salePrice
      onSale
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
            price
            regularPrice
            salePrice
            stockStatus
            stockQuantity
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

// Search products
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

// Filter products with multiple criteria
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
