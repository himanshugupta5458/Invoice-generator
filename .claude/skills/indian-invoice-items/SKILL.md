---
name: indian-invoice-items
description: Authentic Indian retail and wholesale item names with their HSN/SAC codes and typical GST slabs, organised by trade. Grounds Quick Fill's generated rows so a sample invoice reads like a real Indian shop's invoice rather than generic English.
---

# Indian invoice items

Quick Fill asks a model to draft the item rows of a sample GST invoice. Left to
itself, a model writes "Wooden Table" and "Decorative Lamp" — plausible English,
but not what appears on a bill from a shop in Karol Bagh or a wholesaler in
Surat. This file is the reference that fixes that: real item names, the HSN or
SAC code that goes with each, and the slab that trade normally works at.

Everything below the `## Catalogue` heading is appended verbatim to Quick Fill's
system prompt (see `lib/quick-fill-catalog.ts`), so it is written for a model to
read, not for a person to browse.

> **These figures are indicative, and this is not tax advice.** Quick Fill
> produces *sample* invoices for trying the app out; §16 of the spec says so on
> screen. GST slabs move with council notifications and several depend on sale
> value or on whether goods are branded — the notes column flags the ones that
> do. Check any rate against the current notification before it goes on a real
> invoice. A rate the user names in their description overrides everything here.

## How to add a category

One `###` heading per trade, then a table with these three columns and an
optional note. Keep item names as they would be typed on an actual invoice —
including the abbreviations and the sizes.

```md
### Trade name

| Item | HSN/SAC | GST | Notes |
| --- | --- | --- | --- |
| Item as written on a real bill | 1234 | 18% | only when something conditions the rate |
```

Guidance that applies while filling this in:

- Prefer the specific over the generic: "Brake Pad Set — Maruti Swift" beats
  "Brake pads", and "Kanjivaram Silk Saree 6.3m" beats "Silk saree".
- 4-digit HSN is enough; use 6 or 8 digits only where the slab depends on it.
- Where a trade genuinely spans slabs, list items from each rather than
  averaging — the mix is the point.
- Leave the HSN blank rather than guess one. A wrong HSN on a sample invoice is
  worse than an absent one, and the field is optional (§4).

## Catalogue

Only a few examples per category are filled in below. Extend them.

### Artificial jewellery

| Item | HSN/SAC | GST | Notes |
| --- | --- | --- | --- |
| Oxidised Jhumka Earrings | 7117 | 3% | |
| Kundan Choker Necklace Set | 7117 | 3% | |
| American Diamond Bangles (pair) | 7117 | 3% | |

### Motor parts

| Item | HSN/SAC | GST | Notes |
| --- | --- | --- | --- |
| Brake Pad Set — Maruti Swift | 8708 | 28% | |
| Clutch Plate Assembly | 8708 | 28% | |
| Oil Filter — Element Type | 8421 | 18% | |

### Textiles and apparel

| Item | HSN/SAC | GST | Notes |
| --- | --- | --- | --- |
| Cotton Round-Neck T-Shirt | 6109 | 5% | 12% once the sale value passes ₹1,000 a piece |
| Kanjivaram Silk Saree 6.3m | 5007 | 5% | |
| Denim Jeans — Regular Fit | 6203 | 12% | above ₹1,000 a piece |

### Furniture

| Item | HSN/SAC | GST | Notes |
| --- | --- | --- | --- |
| Sheesham Wood Dining Table 6-Seater | 9403 | 18% | |
| Fabric 3-Seater Sofa | 9401 | 18% | |
| Steel Almirah 4-Door | 9403 | 18% | |

### Electronics

| Item | HSN/SAC | GST | Notes |
| --- | --- | --- | --- |
| Smartphone 6.5" 128GB | 8517 | 18% | |
| LED Bulb 9W B22 | 9405 | 18% | |
| Ceiling Fan 1200mm | 8414 | 18% | |

### FMCG and groceries

| Item | HSN/SAC | GST | Notes |
| --- | --- | --- | --- |
| Basmati Rice 5kg — Branded | 1006 | 5% | 0% loose and unbranded |
| Refined Sunflower Oil 1L Pouch | 1512 | 5% | |
| Toilet Soap Bar 100g | 3401 | 18% | |

### Hardware

| Item | HSN/SAC | GST | Notes |
| --- | --- | --- | --- |
| OPC 53 Grade Cement 50kg Bag | 2523 | 28% | |
| TMT Steel Bar 12mm | 7214 | 18% | |
| PVC Pipe 1" x 10ft | 3917 | 18% | |

### Stationery

| Item | HSN/SAC | GST | Notes |
| --- | --- | --- | --- |
| Long Exercise Book 172 Pages | 4820 | 12% | |
| HB Pencil (pack of 10) | 9609 | 12% | |
| A4 Copier Paper 75 GSM Ream | 4802 | 12% | |
