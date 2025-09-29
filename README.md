# VIP Reformas Scraper

Scraper para VIP Reformas usando Puppeteer y Express.

## Endpoints

### POST /check-work
Verifica si un work_id existe.

**Body:**
```json
{
  "work_id": "181257"
}