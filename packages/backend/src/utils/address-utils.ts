import { CML } from '@lucid-evolution/lucid';

/**
 * Address type categorization
 */
export enum AddressType {
  BECH32_BASE,
  BECH32_ENTERPRISE,
  BECH32_STAKE,
  HEX_PAYMENT_KEY_HASH,
  HEX_FULL_ADDRESS,
  UNKNOWN
}

/**
 * Categorize address type based on format
 */
export function categorizeAddress(address: string): AddressType {
  if (address.startsWith('addr1q')) return AddressType.BECH32_BASE;
  if (address.startsWith('addr1v')) return AddressType.BECH32_ENTERPRISE;
  if (address.startsWith('stake1')) return AddressType.BECH32_STAKE;
  
  if (address.length === 56 && /^[0-9a-fA-F]+$/.test(address)) {
    return AddressType.HEX_PAYMENT_KEY_HASH;
  }
  
  if (address.length === 114 && /^[0-9a-fA-F]+$/.test(address)) {
    return AddressType.HEX_FULL_ADDRESS;
  }
  
  return AddressType.UNKNOWN;
}

/**
 * Convert payment key hash to enterprise address
 */
export function convertPaymentKeyHashToAddress(paymentKeyHash: string): string {
  try {
    const network = 1;
    const paymentKeyHashObj = CML.Ed25519KeyHash.from_hex(paymentKeyHash);
    const paymentCredential = CML.Credential.new_pub_key(paymentKeyHashObj);
    const enterpriseAddress = CML.EnterpriseAddress.new(network, paymentCredential);

    return enterpriseAddress.to_address().to_bech32(undefined);
  } catch (error) {
    throw new Error(`Failed to convert payment key hash to address: ${error}`);
  }
}

/**
 * Convert hex address to bech32 format
 */
export function convertHexAddressToBech32(hexAddress: string): string {
  try {
    const addressObj = CML.Address.from_hex(hexAddress);
    return addressObj.to_bech32(undefined);
  } catch (error) {
    throw new Error(`Failed to convert hex address to bech32: ${error}`);
  }
}

/**
 * Convert any address format to a usable bech32 address
 * Handles payment key hash, full hex address, and already valid bech32 addresses
 */
export function normalizeAddress(address: string): string {
  const addressType = categorizeAddress(address);
  
  switch (addressType) {
    case AddressType.BECH32_BASE:
    case AddressType.BECH32_ENTERPRISE:
    case AddressType.BECH32_STAKE:
      return address;
      
    case AddressType.HEX_PAYMENT_KEY_HASH:
      return convertPaymentKeyHashToAddress(address);
      
    case AddressType.HEX_FULL_ADDRESS:
      return convertHexAddressToBech32(address);
      
    default:
      throw new Error(`Unsupported address format: ${address}`);
  }
}

/**
 * Try to decode a hex string to UTF-8
 */
export function tryDecodeHex(hex: string): string {
  try {
    const bytes = Buffer.from(hex, 'hex');
    return bytes.toString('utf8');
  } catch {
    return hex;
  }
} 