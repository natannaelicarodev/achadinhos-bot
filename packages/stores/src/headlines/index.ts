export {
  captionProvider,
  DictionaryCaptionProvider,
  findProductType,
  normalizeTitle,
  titleGender,
  isDiscountHeadline,
  GENERIC_HEADLINE_KEY,
  HEADLINE_NO_REPEAT,
  type CaptionProvider,
  type CaptionProduct,
  type HeadlineKey,
  type PickOptions,
} from "./provider";
export { chooseHeadline, withHeadlineKeys, classifyForCatalog, type HeadlineSettings, type HeadlineProduct } from "./choose";
export {
  PRODUCT_TYPES,
  CATEGORY_HEADLINES,
  GENERIC_HEADLINES,
  DISCOUNT_HEADLINES,
  DISCOUNT_HEADLINE_MIN_PCT,
  DISCOUNT_HEADLINE_EVERY,
  type HeadlineType,
} from "./dictionary";
export { recentGroupHeadlines } from "./recent";
