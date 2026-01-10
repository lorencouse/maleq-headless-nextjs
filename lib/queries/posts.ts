import { gql } from '@apollo/client';

// Fragment for post fields
export const POST_FIELDS = gql`
  fragment PostFields on Post {
    id
    title
    slug
    excerpt
    date
    modified
    commentCount
    author {
      node {
        id
        name
        slug
        avatar {
          url
        }
      }
    }
    featuredImage {
      node {
        id
        sourceUrl
        altText
        mediaDetails {
          width
          height
        }
      }
    }
    categories {
      nodes {
        id
        name
        slug
      }
    }
    tags {
      nodes {
        id
        name
        slug
      }
    }
  }
`;

// Get all posts with pagination
export const GET_ALL_POSTS = gql`
  ${POST_FIELDS}
  query GetAllPosts($first: Int = 10, $after: String) {
    posts(first: $first, after: $after, where: { orderby: { field: DATE, order: DESC } }) {
      nodes {
        ...PostFields
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

// Get single post by slug
export const GET_POST_BY_SLUG = gql`
  ${POST_FIELDS}
  query GetPostBySlug($slug: String!) {
    postBy(slug: $slug) {
      ...PostFields
      content
      comments {
        nodes {
          id
          content
          date
          author {
            node {
              name
              email
              avatar {
                url
              }
            }
          }
          parent {
            node {
              id
            }
          }
        }
      }
    }
  }
`;

// Get posts by category
export const GET_POSTS_BY_CATEGORY = gql`
  ${POST_FIELDS}
  query GetPostsByCategory($categoryName: String!, $first: Int = 10, $after: String) {
    posts(
      first: $first
      after: $after
      where: {
        categoryName: $categoryName
        orderby: { field: DATE, order: DESC }
      }
    ) {
      nodes {
        ...PostFields
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

// Get all post slugs for static generation
export const GET_ALL_POST_SLUGS = gql`
  query GetAllPostSlugs {
    posts(first: 10000) {
      nodes {
        slug
      }
    }
  }
`;

// Get all categories
export const GET_ALL_CATEGORIES = gql`
  query GetAllCategories {
    categories {
      nodes {
        id
        name
        slug
        count
      }
    }
  }
`;
