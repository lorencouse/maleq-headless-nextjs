import type { FulfillmentShippingMethod } from './types';

const STC_BASE_URL = (
  process.env.STC_ORDER_API_URL || 'https://api.cnv.com'
).replace(/\/+$/, '');
const STC_API_KEY = process.env.STC_API_KEY || '';

const WILLIAMS_WMS_URL =
  process.env.WILLIAMS_WMS_URL ||
  'https://muffsandcuffs.com/WMS/webservices/index.php';
const WILLIAMS_CUSTOMER_NUMBER =
  process.env.WILLIAMS_WMS_CUSTOMER_NUMBER || '';
const WILLIAMS_ACCESS_KEY = process.env.WILLIAMS_WMS_ACCESS_KEY || '';

interface StcShippingAddress {
  firstName: string;
  lastName: string;
  companyName?: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  country: string;
  zip: string;
  phoneNumber?: string;
}

export interface StcCreateOrderPayload {
  order: {
    shippingAddress: StcShippingAddress;
    lineItems: Array<{ upc: string; quantity: number }>;
    shippingMethod: string;
    internalReferenceNumber: string;
  };
}

interface StcCreateOrderResponse {
  status?: string;
  message?: string;
  data?: {
    order_id?: string;
    status?: string;
    created_at?: string;
  };
}

interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseXml(xml: string): XmlNode {
  const input = xml
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .trim();

  const root: XmlNode = { name: '__root__', text: '', children: [] };
  const stack: XmlNode[] = [root];
  const tokenRegex = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[^>]+>|[^<]+/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(input)) !== null) {
    const token = match[0];
    if (!token) continue;

    if (token.startsWith('<!--')) continue;

    if (token.startsWith('<![CDATA[')) {
      const cdata = token.slice(9, -3);
      stack[stack.length - 1].text += cdata;
      continue;
    }

    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    if (token.startsWith('<')) {
      const selfClosing = token.endsWith('/>');
      const rawName = token
        .slice(1, token.length - (selfClosing ? 2 : 1))
        .trim()
        .split(/\s+/)[0];
      if (!rawName || rawName.startsWith('!') || rawName.startsWith('?')) {
        continue;
      }

      const node: XmlNode = { name: rawName, text: '', children: [] };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) {
        stack.push(node);
      }
      continue;
    }

    stack[stack.length - 1].text += token;
  }

  return root.children[0] || root;
}

function findFirstChild(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((child) => child.name === name) || null;
}

function findFirstNode(node: XmlNode, name: string): XmlNode | null {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findFirstNode(child, name);
    if (found) return found;
  }
  return null;
}

function nodeText(node: XmlNode): string {
  let value = node.text || '';
  for (const child of node.children) {
    value += nodeText(child);
  }
  return decodeXml(value).trim();
}

function parseXmlRpcTypedNode(node: XmlNode): unknown {
  switch (node.name) {
    case 'string':
      return nodeText(node);
    case 'int':
    case 'i4': {
      const parsed = Number.parseInt(nodeText(node), 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    case 'double': {
      const parsed = Number.parseFloat(nodeText(node));
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    case 'boolean':
      return nodeText(node) === '1';
    case 'nil':
      return null;
    case 'array': {
      const dataNode = findFirstChild(node, 'data');
      if (!dataNode) return [];
      return dataNode.children
        .filter((child) => child.name === 'value')
        .map((valueNode) => parseXmlRpcValue(valueNode));
    }
    case 'struct': {
      const output: Record<string, unknown> = {};
      const members = node.children.filter((child) => child.name === 'member');
      for (const member of members) {
        const nameNode = findFirstChild(member, 'name');
        const valueNode = findFirstChild(member, 'value');
        if (!nameNode || !valueNode) continue;
        output[nodeText(nameNode)] = parseXmlRpcValue(valueNode);
      }
      return output;
    }
    default:
      return nodeText(node);
  }
}

function parseXmlRpcValue(valueNode: XmlNode): unknown {
  if (valueNode.name !== 'value') {
    return parseXmlRpcTypedNode(valueNode);
  }

  const typedChild = valueNode.children[0];
  if (!typedChild) {
    return nodeText(valueNode);
  }
  return parseXmlRpcTypedNode(typedChild);
}

function parseXmlRpcResponse(xml: string): unknown {
  const root = parseXml(xml);
  const methodResponse =
    root.name === 'methodResponse' ? root : findFirstNode(root, 'methodResponse');
  if (!methodResponse) {
    throw new Error('Invalid Williams XML-RPC response');
  }

  const faultNode = findFirstChild(methodResponse, 'fault');
  if (faultNode) {
    const valueNode = findFirstChild(faultNode, 'value');
    const fault = valueNode ? parseXmlRpcValue(valueNode) : null;
    const message =
      typeof fault === 'object' &&
      fault !== null &&
      'faultString' in fault &&
      typeof (fault as Record<string, unknown>).faultString === 'string'
        ? ((fault as Record<string, unknown>).faultString as string)
        : 'Williams XML-RPC fault';
    throw new Error(message);
  }

  const paramsNode = findFirstChild(methodResponse, 'params');
  const paramNode = paramsNode ? findFirstChild(paramsNode, 'param') : null;
  const valueNode = paramNode ? findFirstChild(paramNode, 'value') : null;
  if (!valueNode) return null;
  return parseXmlRpcValue(valueNode);
}

function toXmlRpcValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '<nil/>';
  }

  if (Array.isArray(value)) {
    return `<array><data>${value
      .map((entry) => `<value>${toXmlRpcValue(entry)}</value>`)
      .join('')}</data></array>`;
  }

  if (typeof value === 'object') {
    return `<struct>${Object.entries(value as Record<string, unknown>)
      .map(
        ([key, entry]) =>
          `<member><name>${escapeXml(key)}</name><value>${toXmlRpcValue(entry)}</value></member>`
      )
      .join('')}</struct>`;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? `<int>${value}</int>`
      : `<double>${value}</double>`;
  }

  if (typeof value === 'boolean') {
    return `<boolean>${value ? 1 : 0}</boolean>`;
  }

  return `<string>${escapeXml(String(value))}</string>`;
}

function buildXmlRpcRequest(methodName: string, params: unknown[]): string {
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>${escapeXml(methodName)}</methodName>
  <params>
    ${params
      .map((param) => `<param><value>${toXmlRpcValue(param)}</value></param>`)
      .join('\n    ')}
  </params>
</methodCall>`;
}

async function callWilliamsMethod(
  methodName: string,
  params: unknown[]
): Promise<unknown> {
  if (!isWilliamsConfigured()) {
    throw new Error('Williams WMS credentials are not configured');
  }

  const xml = buildXmlRpcRequest(methodName, params);
  const response = await fetchWithTimeout(
    WILLIAMS_WMS_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        Accept: 'text/xml',
      },
      body: xml,
    },
    12000
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Williams API request failed (${response.status}): ${body || response.statusText}`
    );
  }

  const responseXml = await response.text();
  return parseXmlRpcResponse(responseXml);
}

export function isStcConfigured(): boolean {
  return Boolean(STC_API_KEY);
}

export function isWilliamsConfigured(): boolean {
  return Boolean(WILLIAMS_CUSTOMER_NUMBER && WILLIAMS_ACCESS_KEY);
}

export function mapStcShippingMethod(
  shippingMethod: FulfillmentShippingMethod,
  countryCode: string
): string {
  const method = (shippingMethod.id || shippingMethod.name || '')
    .trim()
    .toLowerCase();
  const country = countryCode.trim().toUpperCase();

  if (country !== 'US') {
    return '6-20 Business Days';
  }

  if (method.includes('overnight') || method.includes('2 day')) {
    return '2 Business Days';
  }
  if (method.includes('express') || method.includes('priority')) {
    return '3-5 Business Days';
  }

  return process.env.STC_DEFAULT_SHIPPING_METHOD || '4-8 Business Days';
}

export function mapWilliamsShippingMethod(
  shippingMethod: FulfillmentShippingMethod
): string {
  const method = (shippingMethod.id || shippingMethod.name || '')
    .trim()
    .toLowerCase();

  if (method.includes('overnight') || method.includes('express')) {
    return 'Priority';
  }

  return process.env.WILLIAMS_WMS_DEFAULT_SHIPPING_METHOD || 'Standard';
}

export async function submitStcOrder(
  payload: StcCreateOrderPayload
): Promise<{ providerOrderId: string | null }> {
  if (!isStcConfigured()) {
    throw new Error('STC credentials are not configured');
  }

  const response = await fetchWithTimeout(
    `${STC_BASE_URL}/orders`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': STC_API_KEY,
      },
      body: JSON.stringify(payload),
    },
    12000
  );

  const responseBody = (await response.json().catch(() => ({}))) as StcCreateOrderResponse;

  if (!response.ok || responseBody.status === 'error') {
    throw new Error(
      responseBody.message ||
        `STC order submission failed (${response.status})`
    );
  }

  return {
    providerOrderId: responseBody.data?.order_id || null,
  };
}

export async function getStcOrderStatus(referenceNumber: string): Promise<unknown> {
  if (!isStcConfigured()) {
    throw new Error('STC credentials are not configured');
  }

  const response = await fetchWithTimeout(
    `${STC_BASE_URL}/orders/status/${encodeURIComponent(referenceNumber)}`,
    {
      method: 'GET',
      headers: {
        'X-API-KEY': STC_API_KEY,
      },
    },
    12000
  );

  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      responseBody &&
      typeof responseBody === 'object' &&
      'message' in responseBody &&
      typeof (responseBody as Record<string, unknown>).message === 'string'
        ? ((responseBody as Record<string, unknown>).message as string)
        : `STC status request failed (${response.status})`;
    throw new Error(message);
  }

  return responseBody;
}

interface WilliamsProductLine {
  sku: string;
  quantity: number;
}

export interface WilliamsSubmitOrderPayload {
  first_name: string;
  last_name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  email: string;
  phone1?: string;
  shipping_method: string;
  notes?: string;
  reference: string;
  reference2?: string;
  reference3?: string;
  products: WilliamsProductLine[];
}

export async function submitWilliamsOrder(
  order: WilliamsSubmitOrderPayload
): Promise<{ providerOrderId: string | null }> {
  const response = await callWilliamsMethod('weborders.submitOrder', [
    order,
    WILLIAMS_CUSTOMER_NUMBER,
    WILLIAMS_ACCESS_KEY,
  ]);

  if (typeof response === 'number') {
    return { providerOrderId: String(response) };
  }
  if (typeof response === 'string') {
    return { providerOrderId: response };
  }
  if (
    response &&
    typeof response === 'object' &&
    'order_id' in response &&
    typeof (response as Record<string, unknown>).order_id === 'string'
  ) {
    return {
      providerOrderId: (response as Record<string, unknown>).order_id as string,
    };
  }

  return { providerOrderId: null };
}

export async function findWilliamsOrderById(orderId: string): Promise<unknown> {
  const normalizedId = Number.parseInt(orderId, 10);
  if (Number.isNaN(normalizedId)) {
    throw new Error(`Invalid Williams order ID: ${orderId}`);
  }

  return callWilliamsMethod('weborders.findOrderById', [
    normalizedId,
    WILLIAMS_CUSTOMER_NUMBER,
    WILLIAMS_ACCESS_KEY,
  ]);
}
