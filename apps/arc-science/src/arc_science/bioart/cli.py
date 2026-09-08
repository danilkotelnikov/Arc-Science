"""BioArt commands: explicit egress or verified cache-only access."""
from dataclasses import asdict
from pathlib import Path

from . import BioArtClient, BioArtLimits, BioArtSettings


def register(commands):
    group=commands.add_parser('bioart',help='NIH metadata and immutable assets (observed website interface)')
    sub=group.add_subparsers(dest='bioart_command',required=True)
    for name in ('search','inspect','fetch','verify','import'):
        command=sub.add_parser(name)
        if name=='search':
            command.add_argument('query')
            command.add_argument('--search-html',type=Path,help='Explicit operator-supplied browser DOM snapshot; no egress')
        elif name in ('inspect','fetch'): command.add_argument('entry_id',type=int)
        else: command.add_argument('receipt',type=Path)
        command.add_argument('--project',type=Path,default=Path('.'))
        if name in ('search','inspect','fetch'): command.add_argument('--allow-egress',action='store_true')
        if name=='fetch':
            command.add_argument('--representation',type=int,required=True)
            command.add_argument('--format',choices=['svg','png','ai','eps','SVG','PNG','AI','EPS'],required=True)


def run(args):
    # Verify may be invoked on a receipt alone; no egress is possible.
    project=args.project
    if args.bioart_command=='verify':
        client=BioArtClient(args.receipt.absolute().parent,limits=BioArtLimits.from_environment())
        return client.verify(args.receipt.absolute())
    settings=BioArtSettings.from_environment(project)
    client=BioArtClient(settings.cache_dir,allow_egress=getattr(args,'allow_egress',False),limits=settings.limits)
    if args.bioart_command=='inspect':
        entry=client.inspect(args.entry_id)
        return {**asdict(entry),'preferred_representation_id':entry.preferred_representation_id}
    if args.bioart_command=='search':
        if args.search_html is not None:
            if args.allow_egress: raise ValueError('--search-html is offline; omit --allow-egress')
            return client.search_snapshot(args.query,args.search_html)
        return {'hits':[asdict(hit) for hit in client.search(args.query)]}
    if args.bioart_command=='fetch':
        receipt=client.fetch(args.entry_id,args.representation,args.format)
        return {'receipt':str(receipt.receipt_path),'source':str(receipt.source_path),**client.verify(receipt.receipt_path)}
    manifest=client.import_asset(args.receipt.absolute(),project)
    return {'asset_manifest':str(manifest),'asset_id':manifest.parent.name}
