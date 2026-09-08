"""Explicit, source-bound PDF page rasterization. No text-only PDF shortcut for VLM review."""
from dataclasses import dataclass
import io
import math
from .contracts import ArtifactRef,canonical

@dataclass(frozen=True)
class RasterBundle:
    views:tuple[ArtifactRef,...]
    manifest:ArtifactRef

def rasterize_pdf(store,source:ArtifactRef,*,dpi:int=150,max_pages:int=100,max_pixels:int=200_000_000) -> RasterBundle:
    import pypdfium2 as pdfium
    if source.media_type!='application/pdf' or not 72<=dpi<=600:raise ValueError('Invalid PDF or DPI')
    data=store.read(source);document=pdfium.PdfDocument(data);views=[];records=[]
    try:
        count=len(document)
        if count<1 or count>max_pages:raise ValueError('PDF page limit exceeded; no partial acceptance')
        dimensions=[];scale=dpi/72
        for i in range(count):
            page=document[i]
            try:w,h=page.get_size();dimensions.append((math.ceil(w*scale),math.ceil(h*scale)))
            finally:page.close()
        if sum(w*h for w,h in dimensions)>max_pixels:raise ValueError('PDF raster budget exceeded')
        for i in range(count):
            page=document[i];bitmap=None
            try:
                bitmap=page.render(scale=scale);image=bitmap.to_pil();buffer=io.BytesIO()
                image.save(buffer,format='PNG');image.close()
                ref=store.put(buffer.getvalue(),name=f'{source.digest[:12]}-page-{i+1:04d}.png',media_type='image/png',role='render')
                views.append(ref);records.append({'page':i+1,'digest':ref.digest,'dpi':dpi,'pixel_size':list(dimensions[i])})
            finally:
                if bitmap is not None:bitmap.close()
                page.close()
    finally:document.close()
    manifest=store.put(canonical({'source_digest':source.digest,'page_count':count,'views':records}),
                       name='page-coverage.json',media_type='application/json',role='metadata')
    return RasterBundle(tuple(views),manifest)
