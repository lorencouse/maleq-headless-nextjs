import { gql } from 'graphql-request';

// Fragment for post fields
export const POST_FIELDS = gql`
  fragment PostFields on Post {
    id
    databaseId
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
    categories(where: { hideEmpty: true }) {
      nodes {
        id
        name
        slug
        count
        description
      }
    }
  }
`;

// Get a single category by slug
export const GET_CATEGORY_BY_SLUG = gql`
  query GetCategoryBySlug($slug: ID!) {
    category(id: $slug, idType: SLUG) {
      id
      name
      slug
      count
      description
    }
  }
`;

// Get posts by tag
export const GET_POSTS_BY_TAG = gql`
  ${POST_FIELDS}
  query GetPostsByTag($tag: String!, $first: Int = 10, $after: String) {
    posts(
      first: $first
      after: $after
      where: {
        tag: $tag
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

// Get all tags
export const GET_ALL_TAGS = gql`
  query GetAllTags {
    tags(where: { hideEmpty: true }, first: 100) {
      nodes {
        id
        name
        slug
        count
      }
    }
  }
`;

// Get a single tag by slug
export const GET_TAG_BY_SLUG = gql`
  query GetTagBySlug($slug: ID!) {
    tag(id: $slug, idType: SLUG) {
      id
      name
      slug
      count
      description
    }
  }
`;

// Create a comment mutation
export const CREATE_COMMENT = gql`
  mutation CreateComment($input: CreateCommentInput!) {
    createComment(input: $input) {
      success
      comment {
        id
        content
        date
        author {
          node {
            name
            email
          }
        }
      }
    }
  }
`;

// Get related posts by category (excluding current post is done client-side)
export const GET_RELATED_POSTS = gql`
  ${POST_FIELDS}
  query GetRelatedPosts($categorySlug: String!, $first: Int = 5) {
    posts(
      first: $first
      where: {
        categoryName: $categorySlug
        orderby: { field: DATE, order: DESC }
      }
    ) {
      nodes {
        ...PostFields
      }
    }
  }
`;

// Search posts by keyword (searches title, content, excerpt)
export const SEARCH_POSTS = gql`
  ${POST_FIELDS}
  query SearchPosts($search: String!, $first: Int = 20, $categoryName: String) {
    posts(
      first: $first
      where: {
        search: $search
        categoryName: $categoryName
        orderby: { field: DATE, order: DESC }
      }
    ) {
      nodes {
        ...PostFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Search posts by title only (more relevant results)
export const SEARCH_POSTS_BY_TITLE = gql`
  ${POST_FIELDS}
  query SearchPostsByTitle($titleSearch: String!, $first: Int = 20, $categoryName: String) {
    posts(
      first: $first
      where: {
        titleSearch: $titleSearch
        categoryName: $categoryName
        orderby: { field: DATE, order: DESC }
      }
    ) {
      nodes {
        ...PostFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
