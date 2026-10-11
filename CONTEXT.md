# musicalimage

Pairs a personal photo with the music its owner was listening to when it was taken, so the memory of the photo comes back together with its sound.

## Language

**Owner**:
The one person whose Photos and Last.fm history a running instance uses.
_Avoid_: User, account, listener

**Photo**:
A single image from the owner's photo library, identified by the moment it was taken.
_Avoid_: Image, picture, media item

**Capture Time**:
The moment a Photo was taken, as recorded by the camera.
_Avoid_: Photo date, creation time, upload time

**Scrobble**:
One record in the owner's Last.fm listening history: a track, its artist and the moment it was played.
_Avoid_: Play, listen, history entry

**Track**:
A song identified by its title and artist.
_Avoid_: Song, tune

**Memory**:
A Photo together with the Tracks matched to its Capture Time, grouped by Tier.
_Avoid_: Soundtrack, moment, pairing

**Tier**:
One level of closeness between a Scrobble and a Capture Time: At the moment, That day, That week, or That month. A Memory shows every Tier that has Tracks.
_Avoid_: Level, range, window
