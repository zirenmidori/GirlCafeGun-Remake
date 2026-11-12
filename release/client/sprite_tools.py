"""Native rectangular Sprite authoring; original input pixels remain private."""
from pathlib import Path
import copy,hashlib,struct
from PIL import Image
import asset_tools as stock
from asset_tools import pointers
def clone(source, asset, path_id):
    obj = copy.copy(source)
    obj.assets_file = asset
    obj.path_id = path_id
    assert path_id not in asset.objects
    asset.objects[path_id] = obj
    return obj

def add_icon(source_texture, source_sprite, asset, first_id, path, image):
    tex = clone(source_texture, asset, first_id)
    sprite = clone(source_sprite, asset, first_id + 1)
    name = Path(path).stem
    width, height = image.size
    rect = {"x": 0., "y": 0., "width": float(width), "height": float(height)}
    unit = 100.
    half_width, half_height = width / (2 * unit), height / (2 * unit)
    tree = tex.read_typetree()
    tree.update(m_Name=name, m_Width=width, m_Height=height, m_CompleteImageSize=width * height * 4,
                m_TextureFormat=4, m_MipCount=1, m_IsReadable=False, m_StreamingMipmaps=False,
                m_StreamData={"offset": 0, "size": 0, "path": ""})
    tree["image data"] = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes()
    tex.save_typetree(tree)

    tree = sprite.read_typetree()
    zero = {"x": 0., "y": 0.}
    tree.update(m_Name=name, m_Rect=rect, m_Offset=zero, m_Pivot={"x": .5, "y": .5},
                m_PixelsToUnits=unit, m_IsPolygon=False, m_SpriteAtlas=stock.ptr(), m_AtlasTags=[],
                m_PhysicsShape=[], m_Bones=[])
    digest = hashlib.md5(path.lower().encode("ascii")).digest()
    tree["m_RenderDataKey"] = [dict(zip(("data[0]", "data[1]", "data[2]", "data[3]"),
                                       struct.unpack("<4I", digest))), 21300000]
    rd = tree["m_RD"]
    rd.update(texture=stock.ptr(tex.path_id), alphaTexture=stock.ptr(), textureRect=rect,
              textureRectOffset=zero, atlasRectOffset=zero, m_Bindpose=[],
              uvTransform={"x": unit, "y": width / 2., "z": unit, "w": height / 2.})
    positions = [(-half_width, -half_height, 0.), (half_width, -half_height, 0.),
                 (half_width, half_height, 0.), (-half_width, half_height, 0.)]
    verts = b"".join(struct.pack("<3f", *v) for v in positions)
    verts += b"".join(struct.pack("<2f", *v) for v in [(0., 0.), (1., 0.), (1., 1.), (0., 1.)])
    verts += b"".join(struct.pack("<4f4I", 1., 0., 0., 0., 0, 0, 0, 0) for _ in positions)
    rd["m_VertexData"].update(m_VertexCount=4, m_DataSize=verts)
    rd["m_IndexBuffer"] = struct.pack("<6H", 0, 1, 2, 2, 3, 0)
    submesh = copy.deepcopy(rd["m_SubMeshes"][0])
    submesh.update(firstByte=0, indexCount=6, baseVertex=0, firstVertex=0, vertexCount=4)
    submesh["localAABB"] = {"m_Center": {"x": 0., "y": 0., "z": 0.},
                           "m_Extent": {"x": half_width, "y": half_height, "z": 0.}}
    rd["m_SubMeshes"] = [submesh]
    sprite.save_typetree(tree)
    return (tex.path_id, sprite.path_id)
